// ── Vibe Panel: Lazygit-style Git Dashboard ──

let _vibeActivePane = 0;
let _vibeData = {};
let _vibeCmdLog = [];
let _vibeSelectedIdx = {}; // per-pane selected index

async function openVibe() {
  setSidebarLoading('sb-vibe');
  hideAllViews();
  const view = await ensureView('vibe-view');
  view.classList.add('active');
  view.style.display = 'block';
  view.style.height = '100vh';
  if (window.location.hash !== '#vibe') window.location.hash = '#vibe';
  setSidebarActive('sb-vibe');
  _vibeActivePane = 0;
  _vibeSelectedIdx = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  _vibeRefresh();
  document.addEventListener('keydown', _vibeKeyHandler);
}

function _vibeCleanup() {
  document.removeEventListener('keydown', _vibeKeyHandler);
}

async function _vibeGit(cmd, args) {
  const start = Date.now();
  try {
    const resp = await fetch('/api/vibe/git', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ cmd, ...(args || {}) })
    });
    const data = await resp.json();
    const elapsed = Date.now() - start;
    _vibeLogCmd(cmd + (args && args.file ? ' ' + args.file : ''), elapsed);
    return data;
  } catch (e) {
    _vibeLogCmd(cmd + ' FAILED: ' + e.message, 0);
    return { error: e.message };
  }
}

function _vibeLogCmd(cmd, ms) {
  const ts = new Date().toLocaleTimeString();
  _vibeCmdLog.push({ ts, cmd, ms });
  if (_vibeCmdLog.length > 50) _vibeCmdLog.shift();
  const el = document.getElementById('vibe-cmdlog-body');
  if (!el) return;
  el.innerHTML = _vibeCmdLog.map(c =>
    `<span class="text-dimmer">${c.ts}</span> <span class="text-accent">git ${escapeHtml(c.cmd)}</span> <span class="text-dimmest">${c.ms}ms</span>`
  ).reverse().join('<br>');
}

async function _vibeRefresh() {
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

function _vibeRenderStatus(data) {
  const el = document.getElementById('vibe-status-body');
  if (!el) return;
  if (data.error) { el.innerHTML = `<span class="text-red-400">${escapeHtml(data.error)}</span>`; return; }
  const lines = (data.output || '').split('\n').filter(Boolean);
  el.innerHTML = lines.map(l => {
    if (l.startsWith('## ')) return `<div class="vibe-status-branch">${escapeHtml(l.slice(3))}</div>`;
    return `<div class="vibe-row">${_vibeColorStatus(l)}</div>`;
  }).join('') || '<span class="text-dimmer">Clean working tree</span>';
}

function _vibeRenderFiles(data) {
  const el = document.getElementById('vibe-files-body');
  if (!el) return;
  if (data.error) { el.innerHTML = `<span class="text-red-400">${escapeHtml(data.error)}</span>`; return; }
  const files = data.files || [];
  if (!files.length) { el.innerHTML = '<span class="text-dimmer">No changes</span>'; return; }
  el.innerHTML = files.map((f, i) =>
    `<div class="vibe-row vibe-selectable" data-pane="1" data-idx="${i}" onclick="_vibeSelectFile(${i})">${_vibeFileStatusBadge(f.status)} ${escapeHtml(f.path)}</div>`
  ).join('');
}

function _vibeRenderBranches(data) {
  const el = document.getElementById('vibe-branches-body');
  if (!el) return;
  if (data.error) { el.innerHTML = `<span class="text-red-400">${escapeHtml(data.error)}</span>`; return; }
  const branches = data.branches || [];
  if (!branches.length) { el.innerHTML = '<span class="text-dimmer">No branches</span>'; return; }
  el.innerHTML = branches.map((b, i) =>
    `<div class="vibe-row vibe-selectable" data-pane="2" data-idx="${i}" onclick="_vibeSelectBranch(${i})">${b.current ? '<span class="text-green-400">* </span>' : '  '}${escapeHtml(b.name)} <span class="text-dimmer">${escapeHtml(b.hash || '')} ${escapeHtml(b.date || '')}</span>${b.track ? ' <span class="text-yellow-400">' + escapeHtml(b.track) + '</span>' : ''}</div>`
  ).join('');
}

function _vibeRenderCommits(data) {
  const el = document.getElementById('vibe-commits-body');
  if (!el) return;
  if (data.error) { el.innerHTML = `<span class="text-red-400">${escapeHtml(data.error)}</span>`; return; }
  const commits = data.commits || [];
  if (!commits.length) { el.innerHTML = '<span class="text-dimmer">No commits</span>'; return; }
  el.innerHTML = commits.map((c, i) =>
    `<div class="vibe-row vibe-selectable" data-pane="3" data-idx="${i}" onclick="_vibeSelectCommit(${i})"><span class="text-accent">${escapeHtml(c.hash)}</span> ${escapeHtml(c.subject)} <span class="text-dimmer">${escapeHtml(c.author)} ${escapeHtml(c.date)}</span></div>`
  ).join('');
}

function _vibeRenderStash(data) {
  const el = document.getElementById('vibe-stash-body');
  if (!el) return;
  if (data.error) { el.innerHTML = `<span class="text-red-400">${escapeHtml(data.error)}</span>`; return; }
  const entries = data.entries || [];
  if (!entries.length) { el.innerHTML = '<span class="text-dimmer">No stash entries</span>'; return; }
  el.innerHTML = entries.map((s, i) =>
    `<div class="vibe-row vibe-selectable" data-pane="4" data-idx="${i}" onclick="_vibeSelectStash(${i})">${escapeHtml(s)}</div>`
  ).join('');
}

function _vibeColorStatus(line) {
  const code = line.substring(0, 2);
  const path = line.substring(3);
  let color = 'text-primary';
  if (code.includes('M')) color = 'text-yellow-400';
  else if (code.includes('A') || code.includes('?')) color = 'text-green-400';
  else if (code.includes('D')) color = 'text-red-400';
  else if (code.includes('R')) color = 'text-blue-400';
  return `<span class="${color}">${escapeHtml(code)}</span> ${escapeHtml(path)}`;
}

function _vibeFileStatusBadge(status) {
  const colors = { M: 'text-yellow-400', A: 'text-green-400', D: 'text-red-400', '?': 'text-green-400', R: 'text-blue-400', U: 'text-red-400' };
  const c = colors[status] || 'text-dimmer';
  return `<span class="${c} inline-block w-4 text-center">${escapeHtml(status)}</span>`;
}

async function _vibeSelectFile(idx) {
  _vibeSelectedIdx[1] = idx;
  _vibeActivePane = 1;
  _vibeUpdateActivePane();
  _vibeUpdateSelection(1);
  const files = (_vibeData.files && _vibeData.files.files) || [];
  const f = files[idx];
  if (!f) return;
  const data = await _vibeGit('diff', { file: f.path });
  _vibeShowDetail('Diff: ' + f.path, data.output || data.error || 'No diff');
}

async function _vibeSelectBranch(idx) {
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

async function _vibeSelectCommit(idx) {
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

async function _vibeSelectStash(idx) {
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

function _vibeShowDetail(title, content) {
  const header = document.querySelector('#vibe-pane-detail .vibe-pane-header');
  if (header) header.innerHTML = `<span class="vibe-pane-key">0</span> ${escapeHtml(title)}`;
  const body = document.getElementById('vibe-detail-body');
  if (!body) return;
  body.innerHTML = `<pre class="vibe-detail-pre">${_vibeColorDiff(escapeHtml(content))}</pre>`;
}

function _vibeColorDiff(escaped) {
  return escaped.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="text-green-400">${line}</span>`;
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="text-red-400">${line}</span>`;
    if (line.startsWith('@@')) return `<span class="text-blue-400">${line}</span>`;
    if (line.startsWith('diff ') || line.startsWith('index ')) return `<span class="text-dimmer">${line}</span>`;
    return line;
  }).join('\n');
}

function _vibeUpdateActivePane() {
  document.querySelectorAll('.vibe-pane').forEach(p => p.classList.remove('vibe-pane-active'));
  const panes = document.querySelectorAll('.vibe-pane');
  // Map activePane index to pane
  const paneIds = ['vibe-pane-status', 'vibe-pane-files', 'vibe-pane-branches', 'vibe-pane-commits', 'vibe-pane-stash', 'vibe-pane-detail'];
  const activeId = paneIds[_vibeActivePane];
  const activeEl = document.getElementById(activeId);
  if (activeEl) activeEl.classList.add('vibe-pane-active');
}

function _vibeUpdateSelection(paneIdx) {
  const rows = document.querySelectorAll(`.vibe-selectable[data-pane="${paneIdx}"]`);
  rows.forEach(r => r.classList.remove('vibe-row-selected'));
  const idx = _vibeSelectedIdx[paneIdx] || 0;
  if (rows[idx]) {
    rows[idx].classList.add('vibe-row-selected');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }
}

function _vibeKeyHandler(e) {
  // Don't intercept if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  // Don't handle if we're not on the vibe view
  if (window.location.hash !== '#vibe') return;

  const paneCount = 6;

  if (e.key === 'Tab') {
    e.preventDefault();
    _vibeActivePane = (_vibeActivePane + (e.shiftKey ? -1 : 1) + paneCount) % paneCount;
    _vibeUpdateActivePane();
    return;
  }
  if (e.key >= '0' && e.key <= '5') {
    e.preventDefault();
    const n = parseInt(e.key);
    // 1-5 map to left panes (0-4), 0 maps to detail (5)
    _vibeActivePane = n === 0 ? 5 : n - 1;
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

function _vibeMoveSelection(delta) {
  const pane = _vibeActivePane;
  if (pane >= 5) return; // detail pane has no selection
  const rows = document.querySelectorAll(`.vibe-selectable[data-pane="${pane}"]`);
  if (!rows.length) return;
  let idx = (_vibeSelectedIdx[pane] || 0) + delta;
  idx = Math.max(0, Math.min(rows.length - 1, idx));
  _vibeSelectedIdx[pane] = idx;
  _vibeUpdateSelection(pane);
}

function _vibeActivateSelection() {
  const pane = _vibeActivePane;
  const idx = _vibeSelectedIdx[pane] || 0;
  if (pane === 1) _vibeSelectFile(idx);
  else if (pane === 2) _vibeSelectBranch(idx);
  else if (pane === 3) _vibeSelectCommit(idx);
  else if (pane === 4) _vibeSelectStash(idx);
}

// Auto-refresh when tab regains focus
window.addEventListener('focus', () => {
  if (window.location.hash === '#vibe') _vibeRefresh();
});
