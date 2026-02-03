// ── Vault (Obsidian-style notes) ──

let _vaultNotes = [];
let _vaultCurrentNote = null;
let _vaultPreviewMode = false;
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

  // Setup editor auto-save
  const editor = document.getElementById('vault-editor');
  if (editor) {
    editor.addEventListener('input', () => {
      clearTimeout(_vaultSaveTimeout);
      _vaultSaveTimeout = setTimeout(saveCurrentNote, 1000);
      updateVaultPreview();
    });
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
        <div class="vault-folder-header" onclick="toggleVaultFolder(this.parentElement)">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          ${escapeHtml(folder)}
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
    <div class="vault-file-item ${isActive ? 'active' : ''}" data-note-id="${note.id}" onclick="openVaultNote('${note.id}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
      <span class="truncate">${escapeHtml(note.title || 'Untitled')}</span>
    </div>
  `;
}

function toggleVaultFolder(el) {
  el.classList.toggle('collapsed');
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

  updateVaultPreview();
  updateVaultBacklinks();
  updateVaultTags();

  // Reset to editor view
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
      _vaultNotes.push(note);
      renderVaultFileTree();
      openVaultNote(note.id);
    }
  } catch (e) {
    console.error('Failed to create note', e);
  }
}

// Create new folder (prompts for name)
function vaultNewFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  // Create a note in the new folder
  vaultNewNote(name.trim());
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
  }
}

// Update preview content
function updateVaultPreview() {
  if (!_vaultPreviewMode) return;

  const content = document.getElementById('vault-editor').value;
  const preview = document.getElementById('vault-preview-container');
  preview.innerHTML = renderVaultMarkdown(content);
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
}

// Helper: escape regex special chars
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
