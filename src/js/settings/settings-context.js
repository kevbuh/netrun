import Settings from '../core/core-settings.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { logger } from '/js/logger.js';

// ─── Context Settings ──────────────────────────────────────

export let _contextFiles = [];
export let _contextDir = '';
export let _selectedContextFile = null;
const _contextHasFiles = window.State(false);
const _contextEditorVisible = window.State(false);

export function _renderContextSettings() {
  return window.VStack(
    window.VStack(
      window.Text('Loading context info...').className('text-dimmer text-[0.75rem]')
    ).id('context-info-bar').className('mb-4 p-3 rounded-lg border border-border-subtle bg-card/50'),

    window.HStack(
      window.Text('').className('text-muted text-[0.75rem]').id('context-count-label'),
      window.Spacer(),
      window.Button('+ New Task Context').className('text-[0.7rem] text-accent hover:text-accent/80 transition-colors bg-transparent border-none cursor-pointer')
        .onTap(function() { _createTaskContext(); })
    ).className('flex items-center justify-between mb-3'),

    new window.View('div').id('context-file-list').className('flex flex-col gap-2 mb-4'),

    window.Show(_contextHasFiles,
      null,
      function() {
        return window.VStack(
          window.Text('No context files yet. The agent will create them automatically during conversations.').className('text-dimmer text-[0.8rem]')
        ).className('text-center py-8');
      }
    ),

    window.Show(_contextEditorVisible, function() {
      return window.VStack(
        window.HStack(
          window.Text('').className('text-primary text-[0.85rem] font-medium').id('context-editor-title'),
          window.Spacer(),
          window.Text('').className('text-dimmer text-[0.7rem]').id('context-editor-chars')
        ).className('flex items-center justify-between mb-2'),

        (function() {
          const ta = new window.View('textarea');
          ta.el.id = 'context-editor-textarea';
          ta.el.className = 'w-full rounded-lg border border-border-subtle bg-card/50 text-primary text-[0.78rem] p-3 focus:outline-none focus:border-accent/50 transition-colors';
          ta.cssText('font-family:var(--nr-font-mono);height:40vh;resize:vertical;');
          return ta;
        })(),

        window.HStack(
          window.Button('Save').className('px-3 py-1.5 text-[0.75rem] rounded-md bg-accent text-white hover:bg-accent/80 transition-colors border-none cursor-pointer')
            .onTap(function() { _saveContextFile(); }),
          window.Button('Compact Now').id('context-compact-btn')
            .className('px-3 py-1.5 text-[0.75rem] rounded-md border border-border-subtle text-muted hover:text-primary hover:border-accent/50 transition-colors bg-transparent cursor-pointer')
            .onTap(function() { _compactContextFile(); }),
          window.Spacer(),
          window.Button('Delete').className('px-3 py-1.5 text-[0.75rem] rounded-md text-red-400 hover:text-red-300 border border-transparent hover:border-red-400/30 transition-colors bg-transparent cursor-pointer')
            .onTap(function() { _deleteContextFile(); })
        ).spacing(2).className('mt-3')
      );
    })
  );
}

export function _renderContextFileCard(f) {
  const name = f.file_id || f.fileId || '';
  const charCount = f.char_count || f.charCount || 0;
  const kb = (charCount / 1024).toFixed(1);
  const updatedTs = f.updated_at || f.updatedAt || 0;
  const compactedTs = f.compacted_at || f.compactedAt || null;
  const updatedAgo = typeof timeAgo === 'function' && updatedTs ? timeAgo(updatedTs * 1000) : 'unknown';
  const compactedLabel = compactedTs && typeof timeAgo === 'function' ? timeAgo(compactedTs * 1000) : 'never';
  const selected = _selectedContextFile === name;

  const card = window.VStack(
    window.HStack(
      window.Text(name).className('text-[0.8rem] ' + (selected ? 'text-accent' : 'text-primary') + ' font-medium'),
      window.Spacer(),
      window.Text(kb + ' KB').className('text-dimmer text-[0.7rem]')
    ),
    window.HStack(
      window.Text('Updated ' + updatedAgo).className('text-dimmer text-[0.65rem]'),
      window.Text('Compacted ' + compactedLabel).className('text-dimmer text-[0.65rem]')
    ).spacing(3).className('mt-1')
  );
  card.el.tagName === 'DIV' && (card.el.role = 'button');
  card.className('w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ' +
    (selected ? 'border-accent/50 bg-accent/5' : 'border-border-subtle bg-card/50 hover:border-accent/30'));
  card.onTap(function() { _selectContextFile(name); });
  return card;
}

export function _renderContextFileList() {
  const list = document.getElementById('context-file-list');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < _contextFiles.length; i++) {
    AetherUI.append(_renderContextFileCard(_contextFiles[i]), list);
  }
}

export function _loadContextFiles() {
  apiGet('/api/context/list')
    .then(function(data) {
      _contextFiles = data.files || [];
      _contextDir = data.dir || '';
      _contextHasFiles.value = _contextFiles.length > 0;
      const list = document.getElementById('context-file-list');
      const countLabel = document.getElementById('context-count-label');
      const infoBar = document.getElementById('context-info-bar');
      if (!list) return;
      if (_contextFiles.length === 0) {
        list.innerHTML = '';
        if (countLabel) countLabel.textContent = '';
        if (infoBar) AetherUI.mount(window.Text('No context files.').className('text-dimmer text-[0.75rem]'), infoBar);
        return;
      }
      const totalChars = _contextFiles.reduce(function(sum, f) { return sum + (f.char_count || f.charCount || 0); }, 0);
      const totalKb = (totalChars / 1024).toFixed(1);
      if (countLabel) countLabel.textContent = _contextFiles.length + ' file' + (_contextFiles.length !== 1 ? 's' : '');
      if (infoBar) {
        const infoChildren = [
          window.Text(_contextFiles.length + ' file' + (_contextFiles.length !== 1 ? 's' : '')).className('text-primary text-[0.8rem] font-medium'),
          window.Text(totalKb + ' KB total').className('text-dimmer text-[0.7rem]')
        ];
        if (_contextDir) infoChildren.push(window.Text(_contextDir).className('text-dimmer text-[0.65rem]').fontMono());
        AetherUI.mount(HStack(infoChildren).spacing(3), infoBar);
      }
      _renderContextFileList();
    }).catch(function(e) { logger.warn('loadContextFiles:', e); });
}

export function _selectContextFile(fileId) {
  _selectedContextFile = fileId;
  _renderContextFileList();
  _contextEditorVisible.value = true;
  const title = document.getElementById('context-editor-title');
  const textarea = document.getElementById('context-editor-textarea');
  const charsLabel = document.getElementById('context-editor-chars');
  const compactBtn = document.getElementById('context-compact-btn');
  if (title) title.textContent = fileId;
  if (textarea) textarea.value = 'Loading...';
  apiGet('/api/context/read?file=' + encodeURIComponent(fileId))
    .then(function(data) {
      const content = data.content || '';
      if (textarea) {
        textarea.value = content;
        textarea.oninput = function() {
          if (charsLabel) {
            const len = textarea.value.length;
            const kbStr = (len / 1024).toFixed(1);
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
      logger.warn('selectContextFile:', e);
      if (textarea) textarea.value = 'Error loading file.';
    });
}

export function _saveContextFile() {
  if (!_selectedContextFile) return;
  const textarea = document.getElementById('context-editor-textarea');
  if (!textarea) return;
  apiPost('/api/context/update', { file: _selectedContextFile, content: textarea.value })
    .then(function(data) {
      if (typeof showToast === 'function') showToast('Saved');
      for (let i = 0; i < _contextFiles.length; i++) {
        const fid = _contextFiles[i].file_id || _contextFiles[i].fileId;
        if (fid === _selectedContextFile) {
          _contextFiles[i].char_count = data.charCount || textarea.value.length;
          break;
        }
      }
      _renderContextFileList();
    }).catch(function(e) { logger.warn('saveContextFile:', e); });
}

export function _compactContextFile() {
  if (!_selectedContextFile) return;
  const compactBtn = document.getElementById('context-compact-btn');
  if (compactBtn) { compactBtn.textContent = 'Compacting...'; compactBtn.disabled = true; }
  apiPost('/api/context/compact', { file: _selectedContextFile })
    .then(function() {
      if (typeof showToast === 'function') showToast('Compacted');
      _selectContextFile(_selectedContextFile);
      _loadContextFiles();
    }).catch(function(e) {
      logger.warn('compactContextFile:', e);
      if (compactBtn) { compactBtn.textContent = 'Compact Now'; compactBtn.disabled = false; }
    });
}

export function _deleteContextFile() {
  if (!_selectedContextFile) return;
  if (!confirm('Delete ' + _selectedContextFile + '? This cannot be undone.')) return;
  apiDelete('/api/context/' + encodeURIComponent(_selectedContextFile))
    .then(function() {
      _selectedContextFile = null;
      _contextEditorVisible.value = false;
      _loadContextFiles();
    }).catch(function(e) { logger.warn('deleteContextFile:', e); });
}

export function _createTaskContext() {
  let taskId = prompt('Enter a task ID (e.g. "research-llm"):');
  if (!taskId) return;
  taskId = taskId.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!taskId) return;
  const file = 'task-' + taskId + '.md';
  apiPost('/api/context/create', { file: file })
    .then(function() {
      _loadContextFiles();
      setTimeout(function() { _selectContextFile(file); }, 300);
    }).catch(function(e) { logger.warn('createTaskContext:', e); });
}

