// ─── Context Settings ──────────────────────────────────────

let _contextFiles = [];
let _contextDir = '';
let _selectedContextFile = null;

function _renderContextSettings() {
  return RawHTML('<div id="context-info-bar" class="mb-4 p-3 rounded-lg border border-border-subtle bg-card/50">' +
    '<div class="text-dimmer text-[0.75rem]">Loading context info...</div></div>' +
    '<div class="flex items-center justify-between mb-3">' +
    '<span class="text-muted text-[0.75rem]" id="context-count-label"></span>' +
    '<button onclick="_createTaskContext()" class="text-[0.7rem] text-accent hover:text-accent/80 transition-colors">+ New Task Context</button></div>' +
    '<div id="context-file-list" class="flex flex-col gap-2 mb-4"></div>' +
    '<div id="context-empty" class="text-center py-8" style="display:none;">' +
    '<div class="text-dimmer text-[0.8rem]">No context files yet. The agent will create them automatically during conversations.</div></div>' +
    '<div id="context-editor" style="display:none;">' +
    '<div class="flex items-center justify-between mb-2">' +
    '<span class="text-primary text-[0.85rem] font-medium" id="context-editor-title"></span>' +
    '<span class="text-dimmer text-[0.7rem]" id="context-editor-chars"></span></div>' +
    '<textarea id="context-editor-textarea" class="w-full rounded-lg border border-border-subtle bg-card/50 text-primary text-[0.78rem] p-3 focus:outline-none focus:border-accent/50 transition-colors" style="font-family:var(--nr-font-mono);height:40vh;resize:vertical;"></textarea>' +
    '<div class="flex items-center gap-2 mt-3">' +
    '<button onclick="_saveContextFile()" class="px-3 py-1.5 text-[0.75rem] rounded-md bg-accent text-white hover:bg-accent/80 transition-colors">Save</button>' +
    '<button id="context-compact-btn" onclick="_compactContextFile()" class="px-3 py-1.5 text-[0.75rem] rounded-md border border-border-subtle text-muted hover:text-primary hover:border-accent/50 transition-colors">Compact Now</button>' +
    '<button onclick="_deleteContextFile()" class="px-3 py-1.5 text-[0.75rem] rounded-md text-red-400 hover:text-red-300 border border-transparent hover:border-red-400/30 transition-colors ml-auto">Delete</button>' +
    '</div></div>');
}

function _renderContextFileCard(f) {
  const name = f.file_id || f.fileId || '';
  const charCount = f.char_count || f.charCount || 0;
  const kb = (charCount / 1024).toFixed(1);
  const updatedTs = f.updated_at || f.updatedAt || 0;
  const compactedTs = f.compacted_at || f.compactedAt || null;
  const updatedAgo = typeof timeAgo === 'function' && updatedTs ? timeAgo(updatedTs * 1000) : 'unknown';
  const compactedLabel = compactedTs && typeof timeAgo === 'function' ? timeAgo(compactedTs * 1000) : 'never';
  const selected = _selectedContextFile === name;
  return '<button onclick="_selectContextFile(\'' + escapeHtml(name) + '\')" class="w-full text-left p-3 rounded-lg border transition-colors ' +
    (selected ? 'border-accent/50 bg-accent/5' : 'border-border-subtle bg-card/50 hover:border-accent/30') + '">' +
    '<div class="flex items-center justify-between">' +
    '<span class="text-[0.8rem] ' + (selected ? 'text-accent' : 'text-primary') + ' font-medium">' + escapeHtml(name) + '</span>' +
    '<span class="text-dimmer text-[0.7rem]">' + kb + ' KB</span></div>' +
    '<div class="flex items-center gap-3 mt-1">' +
    '<span class="text-dimmer text-[0.65rem]">Updated ' + updatedAgo + '</span>' +
    '<span class="text-dimmer text-[0.65rem]">Compacted ' + compactedLabel + '</span></div></button>';
}

function _loadContextFiles() {
  apiGet('/api/context/list')
    .then(function(data) {
      _contextFiles = data.files || [];
      _contextDir = data.dir || '';
      var list = document.getElementById('context-file-list');
      var empty = document.getElementById('context-empty');
      var countLabel = document.getElementById('context-count-label');
      var infoBar = document.getElementById('context-info-bar');
      if (!list) return;
      if (_contextFiles.length === 0) {
        AetherUI.mount(RawHTML(''), list);
        if (empty) empty.style.display = '';
        if (countLabel) countLabel.textContent = '';
        if (infoBar) AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem]">No context files.</div>'), infoBar);
        return;
      }
      if (empty) empty.style.display = 'none';
      var totalChars = _contextFiles.reduce(function(sum, f) { return sum + (f.char_count || f.charCount || 0); }, 0);
      var totalKb = (totalChars / 1024).toFixed(1);
      if (countLabel) countLabel.textContent = _contextFiles.length + ' file' + (_contextFiles.length !== 1 ? 's' : '');
      if (infoBar) {
        AetherUI.mount(RawHTML('<div class="flex items-center gap-3">' +
          '<span class="text-primary text-[0.8rem] font-medium">' + _contextFiles.length + ' file' + (_contextFiles.length !== 1 ? 's' : '') + '</span>' +
          '<span class="text-dimmer text-[0.7rem]">' + totalKb + ' KB total</span>' +
          (_contextDir ? '<span class="text-dimmer text-[0.65rem] font-mono">' + escapeHtml(_contextDir) + '</span>' : '') + '</div>'), infoBar);
      }
      var html = '';
      for (var i = 0; i < _contextFiles.length; i++) {
        html += _renderContextFileCard(_contextFiles[i]);
      }
      AetherUI.mount(RawHTML(html), list);
    }).catch(function(e) { console.warn('loadContextFiles:', e); });
}

function _selectContextFile(fileId) {
  _selectedContextFile = fileId;
  var list = document.getElementById('context-file-list');
  if (list) {
    var html = '';
    for (var i = 0; i < _contextFiles.length; i++) {
      html += _renderContextFileCard(_contextFiles[i]);
    }
    AetherUI.mount(RawHTML(html), list);
  }
  var editor = document.getElementById('context-editor');
  var title = document.getElementById('context-editor-title');
  var textarea = document.getElementById('context-editor-textarea');
  var charsLabel = document.getElementById('context-editor-chars');
  var compactBtn = document.getElementById('context-compact-btn');
  if (editor) editor.style.display = '';
  if (title) title.textContent = fileId;
  if (textarea) textarea.value = 'Loading...';
  apiGet('/api/context/read?file=' + encodeURIComponent(fileId))
    .then(function(data) {
      var content = data.content || '';
      if (textarea) {
        textarea.value = content;
        textarea.oninput = function() {
          if (charsLabel) {
            var len = textarea.value.length;
            var kbStr = (len / 1024).toFixed(1);
            charsLabel.textContent = kbStr + ' KB' + (len > 8000 ? ' (over threshold)' : '');
            charsLabel.className = 'text-[0.7rem] ' + (len > 8000 ? 'text-amber-400' : 'text-dimmer');
          }
        };
        textarea.oninput();
      }
      if (compactBtn) {
        compactBtn.disabled = content.length < 8000;
        compactBtn.style.opacity = content.length < 8000 ? '0.4' : '1';
      }
    }).catch(function(e) {
      console.warn('selectContextFile:', e);
      if (textarea) textarea.value = 'Error loading file.';
    });
}

function _saveContextFile() {
  if (!_selectedContextFile) return;
  var textarea = document.getElementById('context-editor-textarea');
  if (!textarea) return;
  apiPost('/api/context/update', { file: _selectedContextFile, content: textarea.value })
    .then(function(data) {
      if (typeof showToast === 'function') showToast('Saved');
      for (var i = 0; i < _contextFiles.length; i++) {
        var fid = _contextFiles[i].file_id || _contextFiles[i].fileId;
        if (fid === _selectedContextFile) {
          _contextFiles[i].char_count = data.charCount || textarea.value.length;
          break;
        }
      }
      var list = document.getElementById('context-file-list');
      if (list) {
        var html = '';
        for (var j = 0; j < _contextFiles.length; j++) {
          html += _renderContextFileCard(_contextFiles[j]);
        }
        AetherUI.mount(RawHTML(html), list);
      }
    }).catch(function(e) { console.warn('saveContextFile:', e); });
}

function _compactContextFile() {
  if (!_selectedContextFile) return;
  var compactBtn = document.getElementById('context-compact-btn');
  if (compactBtn) { compactBtn.textContent = 'Compacting...'; compactBtn.disabled = true; }
  apiPost('/api/context/compact', { file: _selectedContextFile })
    .then(function() {
      if (typeof showToast === 'function') showToast('Compacted');
      _selectContextFile(_selectedContextFile);
      _loadContextFiles();
    }).catch(function(e) {
      console.warn('compactContextFile:', e);
      if (compactBtn) { compactBtn.textContent = 'Compact Now'; compactBtn.disabled = false; }
    });
}

function _deleteContextFile() {
  if (!_selectedContextFile) return;
  if (!confirm('Delete ' + _selectedContextFile + '? This cannot be undone.')) return;
  apiDelete('/api/context/' + encodeURIComponent(_selectedContextFile))
    .then(function() {
      _selectedContextFile = null;
      var editor = document.getElementById('context-editor');
      if (editor) editor.style.display = 'none';
      _loadContextFiles();
    }).catch(function(e) { console.warn('deleteContextFile:', e); });
}

function _createTaskContext() {
  var taskId = prompt('Enter a task ID (e.g. "research-llm"):');
  if (!taskId) return;
  taskId = taskId.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!taskId) return;
  var file = 'task-' + taskId + '.md';
  apiPost('/api/context/create', { file: file })
    .then(function() {
      _loadContextFiles();
      setTimeout(function() { _selectContextFile(file); }, 300);
    }).catch(function(e) { console.warn('createTaskContext:', e); });
}
