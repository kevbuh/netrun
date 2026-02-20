// ── Lazygit-style Git Dashboard (embedded in Vault) ──
if (window.AetherUI) AetherUI.globals();

export let _vibeActivePane = 0;
export let _vibeData = {};
export const _vibeCmdLog = [];
export const _vibeSelectedIdx = {};

// ── Git data fetching ──

export async function _vibeGit(cmd, args) {
  const start = Date.now();
  try {
    const data = await apiPost('/api/vibe/git', { cmd, ...(args || {}) });
    const elapsed = Date.now() - start;
    _vibeLogCmd(cmd + (args && args.file ? ' ' + args.file : args && args.ref ? ' ' + args.ref : args && args.branch ? ' ' + args.branch : ''), elapsed);
    return data;
  } catch (e) {
    _vibeLogCmd(cmd + ' FAILED: ' + e.message, 0);
    return { error: e.message };
  }
}

export function _vibeLogCmd(cmd, ms) {
  const ts = new Date().toLocaleTimeString();
  _vibeCmdLog.push({ ts, cmd, ms });
  if (_vibeCmdLog.length > 50) _vibeCmdLog.shift();
  const el = document.getElementById('vibe-cmdlog-body');
  if (!el) return;
  var rows = _vibeCmdLog.slice().reverse().map(function(c) {
    return HStack([
      new View('span').className('text-dimmer')._bindText(c.ts),
      Text(' '),
      new View('span').className('text-accent')._bindText('git ' + escapeHtml(c.cmd)),
      Text(' '),
      new View('span').className('text-dimmest')._bindText(c.ms + 'ms')
    ]);
  });
  AetherUI.mount(VStack(rows), el);
}

export async function _vibeRefresh() {
  const [status, files, branches, log, stash] = await Promise.all([
    _vibeGit('status'),
    _vibeGit('files'),
    _vibeGit('branches'),
    _vibeGit('log'),
    _vibeGit('stash')
  ]);
  _vibeData = { status, files, branches, log, stash };
  _vibeRenderStatus(status);
  _vibeRenderFiles(files);
  _vibeRenderBranches(branches);
  _vibeRenderCommits(log);
  _vibeRenderStash(stash);
  _vibeUpdateActivePane();
}

// ── Pane renderers ──

export function _vibeRenderStatus(data) {
  const el = document.getElementById('vibe-status-body');
  if (!el) return;
  const lines = (data.output || '').split('\n').filter(Boolean);
  AetherUI.mount(Show(!data.error,
    function() {
      return Show(lines.length,
        function() {
          var rows = lines.map(function(l) {
            if (l.startsWith('## ')) return new View('div').className('vibe-status-branch')._bindText(escapeHtml(l.slice(3)));
            return RawHTML('<div class="vibe-row">' + _vibeColorStatus(l) + '</div>');
          });
          return VStack(rows);
        },
        function() { return new View('span').className('text-dimmer')._bindText('Clean working tree'); }
      );
    },
    function() { return new View('span').className('text-red-400')._bindText(escapeHtml(data.error)); }
  ), el);
}

export function _vibeRenderFiles(data) {
  const el = document.getElementById('vibe-files-body');
  if (!el) return;
  const files = data.files || [];
  AetherUI.mount(Show(!data.error,
    function() {
      return Show(files.length,
        function() {
          var rows = files.map(function(f, i) {
            return RawHTML('<div class="vibe-row vibe-selectable" data-pane="1" data-idx="' + i + '">' + _vibeFileStatusBadge(f.status) + ' ' + escapeHtml(f.path) + '</div>')
              .onTap(function() { _vibeSelectFile(i); });
          });
          return VStack(rows);
        },
        function() { return new View('span').className('text-dimmer vibe-row')._bindText('No files'); }
      );
    },
    function() { return new View('span').className('text-red-400')._bindText(escapeHtml(data.error)); }
  ), el);
}

export function _vibeRenderBranches(data) {
  const el = document.getElementById('vibe-branches-body');
  if (!el) return;
  const branches = data.branches || [];
  AetherUI.mount(Show(!data.error,
    function() {
      return Show(branches.length,
        function() {
          var rows = branches.map(function(b, i) {
            var children = [];
            if (b.current) children.push(new View('span').className('text-green-400')._bindText('* '));
            else children.push(Text('  '));
            children.push(new View('span').className('text-accent')._bindText('\u2387 '));
            children.push(Text(escapeHtml(b.name) + ' '));
            if (b.track) children.push(new View('span').className('text-dimmer')._bindText(escapeHtml(b.track)));
            return HStack(children).className('vibe-row vibe-selectable').attr('data-pane', '2').attr('data-idx', String(i))
              .onTap(function() { _vibeSelectBranch(i); });
          });
          return VStack(rows);
        },
        function() { return new View('span').className('text-dimmer vibe-row')._bindText('No branches'); }
      );
    },
    function() { return new View('span').className('text-red-400')._bindText(escapeHtml(data.error)); }
  ), el);
}

export function _vibeRenderCommits(data) {
  const el = document.getElementById('vibe-commits-body');
  if (!el) return;
  const commits = data.commits || [];
  AetherUI.mount(Show(!data.error,
    function() {
      return Show(commits.length,
        function() {
          var rows = commits.map(function(c, i) {
            return HStack([
              new View('span').className('text-yellow-400')._bindText('\u25C6'),
              Text(' '),
              new View('span').className('text-accent')._bindText(escapeHtml(c.hash)),
              Text(' '),
              new View('span').className('text-dimmer')._bindText(escapeHtml(c.author.substring(0, 2).toUpperCase())),
              Text(' \u25CB ' + escapeHtml(c.subject))
            ]).className('vibe-row vibe-selectable').attr('data-pane', '3').attr('data-idx', String(i))
              .onTap(function() { _vibeSelectCommit(i); });
          });
          return VStack(rows);
        },
        function() { return new View('span').className('text-dimmer vibe-row')._bindText('No commits'); }
      );
    },
    function() { return new View('span').className('text-red-400')._bindText(escapeHtml(data.error)); }
  ), el);
}

export function _vibeRenderStash(data) {
  const el = document.getElementById('vibe-stash-body');
  if (!el) return;
  const entries = data.entries || [];
  AetherUI.mount(Show(!data.error,
    function() {
      return Show(entries.length,
        function() {
          var rows = entries.map(function(s, i) {
            return new View('div').className('vibe-row vibe-selectable').attr('data-pane', '4').attr('data-idx', String(i))
              ._bindText(escapeHtml(s))
              .onTap(function() { _vibeSelectStash(i); });
          });
          return VStack(rows);
        },
        function() { return new View('span').className('text-dimmer vibe-row')._bindText('No stash entries'); }
      );
    },
    function() { return new View('span').className('text-red-400')._bindText(escapeHtml(data.error)); }
  ), el);
}

// ── Status helpers ──

export function _vibeColorStatus(line) {
  const code = line.substring(0, 2);
  const path = line.substring(3);
  let color = 'text-primary';
  if (code.includes('M')) color = 'text-yellow-400';
  else if (code.includes('A') || code.includes('?')) color = 'text-green-400';
  else if (code.includes('D')) color = 'text-red-400';
  else if (code.includes('R')) color = 'text-blue-400';
  return `<span class="${color}">${escapeHtml(code)}</span> ${escapeHtml(path)}`;
}

export function _vibeFileStatusBadge(status) {
  if (!status || status.trim() === '') return '<span class="text-dimmer inline-block w-4 text-center">\u00B7</span>';
  const colors = { M: 'text-yellow-400', A: 'text-green-400', D: 'text-red-400', '?': 'text-green-400', R: 'text-blue-400', U: 'text-red-400' };
  const c = colors[status] || 'text-dimmer';
  return `<span class="${c} inline-block w-4 text-center font-bold">${escapeHtml(status)}</span>`;
}

// ── Selection handlers ──

export async function _vibeSelectFile(idx) {
  _vibeSelectedIdx[1] = idx;
  _vibeActivePane = 1;
  _vibeUpdateActivePane();
  _vibeUpdateSelection(1);
  const files = (_vibeData.files && _vibeData.files.files) || [];
  const f = files[idx];
  if (!f) return;
  if (f.status && f.status.trim()) {
    // Changed file — show diff
    const data = await _vibeGit('diff', { file: f.path });
    _vibeShowDetail('Diff: ' + f.path, data.output || data.error || 'No diff');
  } else {
    // Tracked file — show contents via git show
    const data = await _vibeGit('show', { ref: 'HEAD:' + f.path });
    _vibeShowDetail(f.path, data.output || data.error || '(empty)');
  }
}

export async function _vibeSelectBranch(idx) {
  _vibeSelectedIdx[2] = idx;
  _vibeActivePane = 2;
  _vibeUpdateActivePane();
  _vibeUpdateSelection(2);
  const branches = (_vibeData.branches && _vibeData.branches.branches) || [];
  const b = branches[idx];
  if (!b) return;
  const data = await _vibeGit('log', { branch: b.name });
  const commits = data.commits || [];
  _vibeShowDetail('Branch: ' + b.name, commits.map(c => `${c.hash} ${c.subject} (${c.author}, ${c.date})`).join('\n') || 'No commits');
}

export async function _vibeSelectCommit(idx) {
  _vibeSelectedIdx[3] = idx;
  _vibeActivePane = 3;
  _vibeUpdateActivePane();
  _vibeUpdateSelection(3);
  const commits = (_vibeData.log && _vibeData.log.commits) || [];
  const c = commits[idx];
  if (!c) return;
  const data = await _vibeGit('show', { ref: c.hash });
  _vibeShowDetail('Commit: ' + c.hash, data.output || data.error || 'No data');
}

export async function _vibeSelectStash(idx) {
  _vibeSelectedIdx[4] = idx;
  _vibeActivePane = 4;
  _vibeUpdateActivePane();
  _vibeUpdateSelection(4);
  const entries = (_vibeData.stash && _vibeData.stash.entries) || [];
  const s = entries[idx];
  if (!s) return;
  const ref = s.split(':')[0] || `stash@{${idx}}`;
  const data = await _vibeGit('show', { ref });
  _vibeShowDetail('Stash: ' + ref, data.output || data.error || 'No data');
}

// ── Detail pane ──

export function _vibeShowDetail(title, content) {
  const header = document.querySelector('#vibe-pane-detail .vibe-pane-header');
  if (header) {
    AetherUI.mount(HStack([
      new View('span').className('vibe-pane-key')._bindText('0'),
      Text(' ' + escapeHtml(title))
    ]), header);
  }
  const body = document.getElementById('vibe-detail-body');
  if (!body) return;
  AetherUI.mount(RawHTML('<pre class="vibe-detail-pre">' + _vibeColorDiff(escapeHtml(content)) + '</pre>'), body);
}

export function _vibeColorDiff(escaped) {
  return escaped.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="text-green-400">${line}</span>`;
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="text-red-400">${line}</span>`;
    if (line.startsWith('@@')) return `<span class="text-blue-400">${line}</span>`;
    if (line.startsWith('diff ') || line.startsWith('index ')) return `<span class="text-dimmer">${line}</span>`;
    if (line.startsWith('commit ')) return `<span class="text-accent">${line}</span>`;
    if (line.startsWith('Author:') || line.startsWith('Date:')) return `<span class="text-dimmer">${line}</span>`;
    return line;
  }).join('\n');
}

// ── Active pane / selection ──

export function _vibeClickPane(idx) {
  _vibeActivePane = idx;
  _vibeUpdateActivePane();
}

export function _vibeUpdateActivePane() {
  document.querySelectorAll('.vibe-pane').forEach(p => p.classList.remove('vibe-pane-active'));
  const paneIds = ['vibe-pane-status', 'vibe-pane-files', 'vibe-pane-branches', 'vibe-pane-commits', 'vibe-pane-stash', 'vibe-pane-detail'];
  const activeEl = document.getElementById(paneIds[_vibeActivePane]);
  if (activeEl) activeEl.classList.add('vibe-pane-active');
}

export function _vibeUpdateSelection(paneIdx) {
  const rows = document.querySelectorAll(`.vibe-selectable[data-pane="${paneIdx}"]`);
  rows.forEach(r => r.classList.remove('vibe-row-selected'));
  const idx = _vibeSelectedIdx[paneIdx] || 0;
  if (rows[idx]) {
    rows[idx].classList.add('vibe-row-selected');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }
}

// ── Keyboard navigation (only when git mode is active in vault) ──

export function _vibeKeyHandler(e) {
  // Don't intercept if typing in an input or terminal
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.target.closest('.xterm')) return;
  if (!_vaultGitMode) return;

  const paneCount = 6;

  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    _vibeActivePane = (_vibeActivePane + (e.shiftKey ? -1 : 1) + paneCount) % paneCount;
    _vibeUpdateActivePane();
    return;
  }
  if (e.key >= '0' && e.key <= '5') {
    e.preventDefault();
    const n = parseInt(e.key);
    _vibeActivePane = n === 0 ? 5 : n - 1;
    _vibeUpdateActivePane();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'h') {
    e.preventDefault();
    _vibeActivePane = (_vibeActivePane - 1 + paneCount) % paneCount;
    _vibeUpdateActivePane();
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'l') {
    e.preventDefault();
    _vibeActivePane = (_vibeActivePane + 1) % paneCount;
    _vibeUpdateActivePane();
    return;
  }
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    _vibeMoveSelection(1);
    return;
  }
  if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    _vibeMoveSelection(-1);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    _vibeActivateSelection();
    return;
  }
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    _vibeRefresh();
    return;
  }
}

export function _vibeMoveSelection(delta) {
  const pane = _vibeActivePane;
  if (pane >= 5) return;
  const rows = document.querySelectorAll(`.vibe-selectable[data-pane="${pane}"]`);
  if (!rows.length) return;
  let idx = (_vibeSelectedIdx[pane] || 0) + delta;
  idx = Math.max(0, Math.min(rows.length - 1, idx));
  _vibeSelectedIdx[pane] = idx;
  _vibeUpdateSelection(pane);
}

export function _vibeActivateSelection() {
  const pane = _vibeActivePane;
  const idx = _vibeSelectedIdx[pane] || 0;
  if (pane === 1) _vibeSelectFile(idx);
  else if (pane === 2) _vibeSelectBranch(idx);
  else if (pane === 3) _vibeSelectCommit(idx);
  else if (pane === 4) _vibeSelectStash(idx);
}

// Auto-refresh git status when tab regains focus
window.addEventListener('focus', () => {});

// ── Window exports ──
window._vibeActivePane = _vibeActivePane;
window._vibeData = _vibeData;
window._vibeCmdLog = _vibeCmdLog;
window._vibeSelectedIdx = _vibeSelectedIdx;
window._vibeGit = _vibeGit;
window._vibeLogCmd = _vibeLogCmd;
window._vibeRefresh = _vibeRefresh;
window._vibeRenderStatus = _vibeRenderStatus;
window._vibeRenderFiles = _vibeRenderFiles;
window._vibeRenderBranches = _vibeRenderBranches;
window._vibeRenderCommits = _vibeRenderCommits;
window._vibeRenderStash = _vibeRenderStash;
window._vibeColorStatus = _vibeColorStatus;
window._vibeFileStatusBadge = _vibeFileStatusBadge;
window._vibeSelectFile = _vibeSelectFile;
window._vibeSelectBranch = _vibeSelectBranch;
window._vibeSelectCommit = _vibeSelectCommit;
window._vibeSelectStash = _vibeSelectStash;
window._vibeShowDetail = _vibeShowDetail;
window._vibeColorDiff = _vibeColorDiff;
window._vibeClickPane = _vibeClickPane;
window._vibeUpdateActivePane = _vibeUpdateActivePane;
window._vibeUpdateSelection = _vibeUpdateSelection;
window._vibeKeyHandler = _vibeKeyHandler;
window._vibeMoveSelection = _vibeMoveSelection;
window._vibeActivateSelection = _vibeActivateSelection;
