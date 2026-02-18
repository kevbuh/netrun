// ─── Context Settings ──────────────────────────────────────

if (window.AetherUI) AetherUI.globals();

let _contextFiles = [];
let _contextDir = '';
let _selectedContextFile = null;

function _renderContextSettings() {
  return VStack(
    VStack(
      Text('Loading context info...').className('text-dimmer text-[0.75rem]')
    ).id('context-info-bar').className('mb-4 p-3 rounded-lg border border-border-subtle bg-card/50'),

    HStack(
      Text('').className('text-muted text-[0.75rem]').id('context-count-label'),
      Spacer(),
      Button('+ New Task Context').className('text-[0.7rem] text-accent hover:text-accent/80 transition-colors bg-transparent border-none cursor-pointer')
        .onTap(function() { _createTaskContext(); })
    ).className('flex items-center justify-between mb-3'),

    new View('div').id('context-file-list').className('flex flex-col gap-2 mb-4'),

    VStack(
      Text('No context files yet. The agent will create them automatically during conversations.').className('text-dimmer text-[0.8rem]')
    ).id('context-empty').className('text-center py-8').visible(false),

    VStack(
      HStack(
        Text('').className('text-primary text-[0.85rem] font-medium').id('context-editor-title'),
        Spacer(),
        Text('').className('text-dimmer text-[0.7rem]').id('context-editor-chars')
      ).className('flex items-center justify-between mb-2'),

      (function() {
        var ta = new View('textarea');
        ta.el.id = 'context-editor-textarea';
        ta.el.className = 'w-full rounded-lg border border-border-subtle bg-card/50 text-primary text-[0.78rem] p-3 focus:outline-none focus:border-accent/50 transition-colors';
        ta.cssText('font-family:var(--nr-font-mono);height:40vh;resize:vertical;');
        return ta;
      })(),

      HStack(
        Button('Save').className('px-3 py-1.5 text-[0.75rem] rounded-md bg-accent text-white hover:bg-accent/80 transition-colors border-none cursor-pointer')
          .onTap(function() { _saveContextFile(); }),
        Button('Compact Now').id('context-compact-btn')
          .className('px-3 py-1.5 text-[0.75rem] rounded-md border border-border-subtle text-muted hover:text-primary hover:border-accent/50 transition-colors bg-transparent cursor-pointer')
          .onTap(function() { _compactContextFile(); }),
        Spacer(),
        Button('Delete').className('px-3 py-1.5 text-[0.75rem] rounded-md text-red-400 hover:text-red-300 border border-transparent hover:border-red-400/30 transition-colors bg-transparent cursor-pointer')
          .onTap(function() { _deleteContextFile(); })
      ).spacing(2).className('mt-3')
    ).id('context-editor').visible(false)
  );
}

function _renderContextFileCard(f) {
  var name = f.file_id || f.fileId || '';
  var charCount = f.char_count || f.charCount || 0;
  var kb = (charCount / 1024).toFixed(1);
  var updatedTs = f.updated_at || f.updatedAt || 0;
  var compactedTs = f.compacted_at || f.compactedAt || null;
  var updatedAgo = typeof timeAgo === 'function' && updatedTs ? timeAgo(updatedTs * 1000) : 'unknown';
  var compactedLabel = compactedTs && typeof timeAgo === 'function' ? timeAgo(compactedTs * 1000) : 'never';
  var selected = _selectedContextFile === name;

  var card = VStack(
    HStack(
      Text(name).className('text-[0.8rem] ' + (selected ? 'text-accent' : 'text-primary') + ' font-medium'),
      Spacer(),
      Text(kb + ' KB').className('text-dimmer text-[0.7rem]')
    ),
    HStack(
      Text('Updated ' + updatedAgo).className('text-dimmer text-[0.65rem]'),
      Text('Compacted ' + compactedLabel).className('text-dimmer text-[0.65rem]')
    ).spacing(3).className('mt-1')
  );
  card.el.tagName === 'DIV' && (card.el.role = 'button');
  card.className('w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ' +
    (selected ? 'border-accent/50 bg-accent/5' : 'border-border-subtle bg-card/50 hover:border-accent/30'));
  card.onTap(function() { _selectContextFile(name); });
  return card;
}

function _renderContextFileList() {
  var list = document.getElementById('context-file-list');
  if (!list) return;
  list.innerHTML = '';
  for (var i = 0; i < _contextFiles.length; i++) {
    AetherUI.append(_renderContextFileCard(_contextFiles[i]), list);
  }
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
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        if (countLabel) countLabel.textContent = '';
        if (infoBar) AetherUI.mount(Text('No context files.').className('text-dimmer text-[0.75rem]'), infoBar);
        return;
      }
      if (empty) empty.style.display = 'none';
      var totalChars = _contextFiles.reduce(function(sum, f) { return sum + (f.char_count || f.charCount || 0); }, 0);
      var totalKb = (totalChars / 1024).toFixed(1);
      if (countLabel) countLabel.textContent = _contextFiles.length + ' file' + (_contextFiles.length !== 1 ? 's' : '');
      if (infoBar) {
        var infoChildren = [
          Text(_contextFiles.length + ' file' + (_contextFiles.length !== 1 ? 's' : '')).className('text-primary text-[0.8rem] font-medium'),
          Text(totalKb + ' KB total').className('text-dimmer text-[0.7rem]')
        ];
        if (_contextDir) infoChildren.push(Text(_contextDir).className('text-dimmer text-[0.65rem]').fontMono());
        AetherUI.mount(HStack.apply(null, infoChildren).spacing(3), infoBar);
      }
      _renderContextFileList();
    }).catch(function(e) { console.warn('loadContextFiles:', e); });
}

function _selectContextFile(fileId) {
  _selectedContextFile = fileId;
  _renderContextFileList();
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
      _renderContextFileList();
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
