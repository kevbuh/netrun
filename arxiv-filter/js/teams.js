// ── Teams & Inbox ──

let _cachedTeams = [];
let _cachedInvites = [];

function _isArxivUrl(url) {
  return /^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\//.test(url);
}

function _paperViewHash(url) {
  return '#view/' + encodeURIComponent(url);
}

function _resolveTitle(url) {
  // Try to find title from allPapers cache
  if (typeof allPapers !== 'undefined' && allPapers.length) {
    const match = allPapers.find(p => p.link === url || p.link === url.replace('/pdf/', '/abs/') || p.link === url.replace('/abs/', '/pdf/'));
    if (match) return match.title;
  }
  // Try arxiv ID as fallback label
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/);
  if (arxivMatch) return 'arXiv:' + arxivMatch[1];
  return null;
}

function _renderLinkCard(url) {
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const favicon = (() => { try { return new URL(url).origin + '/favicon.ico'; } catch { return ''; } })();
  const title = _resolveTitle(url);
  const isArxiv = _isArxivUrl(url);
  const href = _paperViewHash(url);
  return `<a href="${href}" style="text-decoration:none;display:block" onclick="event.stopPropagation()">
    <div style="background:var(--bg-body);border:1px solid var(--border-card);border-radius:8px;padding:10px 12px;margin-top:4px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        ${favicon ? `<img src="${escapeAttr(favicon)}" style="width:14px;height:14px;border-radius:2px" onerror="this.style.display='none'">` : ''}
        <span style="font-size:0.65rem;color:var(--text-dimmest)">${escapeHtml(hostname)}</span>
        ${isArxiv ? '<span style="font-size:0.6rem;color:var(--accent);font-weight:600">PDF</span>' : ''}
      </div>
      <div style="font-size:0.8rem;color:var(--text-primary);font-weight:500;line-height:1.35">${escapeHtml(title || url)}</div>
    </div>
  </a>`;
}

function _renderAnnotatedCard(url, sections) {
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const favicon = (() => { try { return new URL(url).origin + '/favicon.ico'; } catch { return ''; } })();
  const title = _resolveTitle(url);
  const isArxiv = _isArxivUrl(url);
  const href = _paperViewHash(url);

  let annotHtml = '';
  if (sections.highlights.length) {
    annotHtml += `<div style="margin-top:8px;border-top:1px solid var(--border-card);padding-top:6px">
      <div style="font-size:0.65rem;color:var(--text-dimmest);margin-bottom:4px;font-weight:600">${sections.highlights.length} Highlight${sections.highlights.length > 1 ? 's' : ''}</div>
      ${sections.highlights.slice(0, 3).map(h => `<div style="font-size:0.75rem;color:var(--text-muted);border-left:2px solid var(--accent);padding-left:6px;margin-bottom:4px;line-height:1.35">
        ${escapeHtml(h.text.length > 120 ? h.text.slice(0, 120) + '...' : h.text)}
        ${h.note ? `<div style="font-size:0.7rem;color:var(--text-dimmer);margin-top:2px;font-style:italic">${escapeHtml(h.note)}</div>` : ''}
      </div>`).join('')}
      ${sections.highlights.length > 3 ? `<div style="font-size:0.65rem;color:var(--text-dimmest)">+${sections.highlights.length - 3} more</div>` : ''}
    </div>`;
  }
  if (sections.notes) {
    annotHtml += `<div style="margin-top:6px;border-top:1px solid var(--border-card);padding-top:6px">
      <div style="font-size:0.65rem;color:var(--text-dimmest);margin-bottom:3px;font-weight:600">Notes</div>
      <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;white-space:pre-wrap">${escapeHtml(sections.notes.length > 300 ? sections.notes.slice(0, 300) + '...' : sections.notes)}</div>
    </div>`;
  }

  return `<a href="${href}" style="text-decoration:none;display:block" onclick="event.stopPropagation()">
    <div style="background:var(--bg-body);border:1px solid var(--border-card);border-radius:8px;padding:10px 12px;margin-top:4px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        ${favicon ? `<img src="${escapeAttr(favicon)}" style="width:14px;height:14px;border-radius:2px" onerror="this.style.display='none'">` : ''}
        <span style="font-size:0.65rem;color:var(--text-dimmest)">${escapeHtml(hostname)}</span>
        ${isArxiv ? '<span style="font-size:0.6rem;color:var(--accent);font-weight:600">PDF</span>' : ''}
      </div>
      <div style="font-size:0.8rem;color:var(--text-primary);font-weight:500;line-height:1.35">${escapeHtml(title || url)}</div>
      ${annotHtml}
    </div>
  </a>`;
}

function _parseAnnotatedMessage(content) {
  // Parse: URL\n--- Highlights ---\n> quote\n  Note: ...\n--- Notes ---\n...
  const lines = content.split('\n');
  const url = lines[0].trim();
  if (!/^https?:\/\//.test(url)) return null;
  const highlights = [];
  let notes = '';
  let section = '';
  let currentHighlight = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('--- Highlights ---')) { section = 'highlights'; continue; }
    if (line.startsWith('--- Notes ---')) { section = 'notes'; continue; }
    if (section === 'highlights') {
      if (line.startsWith('> ')) {
        if (currentHighlight) highlights.push(currentHighlight);
        currentHighlight = { text: line.slice(2), note: '' };
      } else if (line.startsWith('  Note: ') && currentHighlight) {
        currentHighlight.note = line.slice(8);
      }
    } else if (section === 'notes') {
      notes += (notes ? '\n' : '') + line;
    }
  }
  if (currentHighlight) highlights.push(currentHighlight);
  if (!highlights.length && !notes) return null;
  return { url, highlights, notes: notes.trim() };
}

function _renderChatContent(content) {
  // Legacy: "📄 {title}\n{url}" format
  const shareMatch = content.match(/^📄 (.+)\n(https?:\/\/\S+)$/);
  if (shareMatch) return _renderLinkCard(shareMatch[2]);

  // Check for annotated share (URL + highlights/notes)
  const annotated = _parseAnnotatedMessage(content);
  if (annotated) return _renderAnnotatedCard(annotated.url, annotated);

  // Bare URL as entire message
  const bareUrl = content.trim().match(/^(https?:\/\/\S+)$/);
  if (bareUrl) return _renderLinkCard(bareUrl[1]);

  // For mixed text+URL, make URLs clickable
  return escapeHtml(content).replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const href = _paperViewHash(url);
    return `<a href="${href}" class="text-accent hover:underline" style="text-decoration:none" onclick="event.stopPropagation()">${escapeHtml(url)}</a>`;
  });
}

// ── Inbox View ──

function openInbox() {
  hideAllViews();
  const view = document.getElementById('inbox-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'inbox';
  setSidebarActive('sb-inbox');
  renderInbox();
}

async function renderInbox() {
  const container = document.getElementById('inbox-content');
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';
  try {
    const [invResp, msgResp] = await Promise.all([
      fetch('/api/inbox', { headers: _authHeaders() }),
      fetch('/api/messages', { headers: _authHeaders() }),
    ]);
    _cachedInvites = await invResp.json();
    const messages = msgResp.ok ? await msgResp.json() : [];

    if (!_cachedInvites.length && !messages.length) {
      container.innerHTML = '<div class="text-center py-20 text-dim text-sm">Nothing here yet</div>';
      return;
    }

    let html = '';

    // Invites
    if (_cachedInvites.length) {
      html += '<div class="text-[0.75rem] text-dim uppercase tracking-wide mb-2">Team Invites</div>';
      html += _cachedInvites.map(inv => `
        <div class="flex items-center justify-between p-4 bg-card border border-border-card rounded-lg mb-2">
          <div>
            <div class="text-primary text-sm font-medium"><a href="#profile/${encodeURIComponent(inv.from_username)}" class="text-primary hover:text-accent" style="text-decoration:none">${escapeHtml(inv.from_username)}</a> invited you to <span class="text-accent font-semibold">${escapeHtml(inv.team_name)}</span></div>
            <div class="text-dimmer text-xs mt-0.5">${inv.created || ''}</div>
          </div>
          <div class="flex gap-2">
            <button onclick="respondToInvite(${inv.id}, true)" class="px-3 py-1 rounded-md text-xs bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Accept</button>
            <button onclick="respondToInvite(${inv.id}, false)" class="px-3 py-1 rounded-md text-xs border border-border-input text-muted bg-card cursor-pointer hover:text-primary transition-colors">Decline</button>
          </div>
        </div>
      `).join('');
    }

    // Messages
    if (messages.length) {
      if (_cachedInvites.length) html += '<div class="text-[0.75rem] text-dim uppercase tracking-wide mb-2 mt-5">Messages</div>';
      html += messages.map(msg => {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(msg.timestamp) : '';
        const unread = !msg.read;
        return `
        <div class="flex items-start gap-3 p-4 bg-card border border-border-card rounded-lg mb-2${unread ? ' border-l-accent border-l-2' : ''}" onclick="markMessageRead('${msg.id}', this)">
          ${msg.from_picture
            ? `<img src="${escapeAttr(msg.from_picture)}" class="w-8 h-8 rounded-full shrink-0" referrerpolicy="no-referrer" />`
            : `<div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold shrink-0">${escapeHtml((msg.from_username || '?')[0].toUpperCase())}</div>`
          }
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <a href="#profile/${encodeURIComponent(msg.from_username)}" class="text-sm font-medium text-primary hover:text-accent" style="text-decoration:none">${escapeHtml(msg.from_username)}</a>
              <span class="text-dimmer text-[0.7rem]">${timeAgo}</span>
              ${unread ? '<span class="w-2 h-2 rounded-full bg-accent shrink-0"></span>' : ''}
            </div>
            <div class="text-[0.82rem] text-primary mt-1 leading-relaxed">${escapeHtml(msg.content)}</div>
          </div>
        </div>`;
      }).join('');
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="text-center py-20 text-red-400 text-sm">Failed to load inbox</div>`;
  }
}

async function markMessageRead(msgId, el) {
  try {
    await fetch(`/api/messages/${msgId}/read`, { method: 'POST', headers: _authHeaders() });
    if (el) {
      el.classList.remove('border-l-accent', 'border-l-2');
      const dot = el.querySelector('.bg-accent.w-2');
      if (dot) dot.remove();
    }
    refreshInboxBadge();
  } catch (err) { /* ignore */ }
}

async function respondToInvite(id, accept) {
  try {
    await fetch(`/api/inbox/${id}/respond`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept })
    });
    renderInbox();
    refreshInboxBadge();
  } catch (err) { /* ignore */ }
}

async function refreshInboxBadge() {
  try {
    const resp = await fetch('/api/messages/unread-count', { headers: _authHeaders() });
    const data = await resp.json();
    const badge = document.getElementById('inbox-badge');
    if (badge) {
      if (data.total > 0) {
        badge.textContent = data.total;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (err) { /* ignore */ }
}

// ── Teams View (standalone page) ──

function openTeams() {
  hideAllViews();
  const view = document.getElementById('teams-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'teams';
  setSidebarActive('sb-teams');
  renderTeamsView();
}

async function renderTeamsView() {
  const container = document.getElementById('teams-view-content');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';
  await fetchTeams();

  if (!_cachedTeams.length) {
    container.innerHTML = '<div class="text-dimmer text-sm mb-4">No teams yet. Create one to start collaborating.</div>';
  } else {
    container.innerHTML = _cachedTeams.map(t => `
      <div class="flex items-center justify-between p-4 bg-card border border-border-card rounded-lg mb-2 group cursor-pointer hover:border-border-input transition-colors" onclick="showTeamDetailView(${t.id})">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-base font-bold">${escapeHtml(t.name[0].toUpperCase())}</div>
          <div>
            <div class="text-primary text-sm font-medium">${escapeHtml(t.name)}</div>
            <div class="text-dimmer text-xs">${t.member_count} member${t.member_count !== 1 ? 's' : ''} · ${escapeHtml(t.role)}</div>
          </div>
        </div>
        <div class="flex gap-1.5" onclick="event.stopPropagation()">
          ${t.role === 'owner' ? `<button onclick="confirmDeleteTeamView(${t.id}, '${escapeAttr(t.name)}')" class="px-2 py-1 rounded text-xs border border-red-800/50 text-red-400/70 bg-transparent cursor-pointer hover:text-red-400 transition-colors">Delete</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  // Create team form
  const formEl = document.getElementById('teams-view-create-form');
  if (formEl) formEl.innerHTML = `
    <div class="flex gap-2 mt-4">
      <input type="text" id="teams-view-new-name" placeholder="New team name" class="flex-1 bg-input border border-border-input rounded-md px-3 py-2 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();createTeamFromView()}">
      <button onclick="createTeamFromView()" class="bg-accent text-white text-sm px-4 py-2 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Create Team</button>
    </div>
  `;
}

async function createTeamFromView() {
  const input = document.getElementById('teams-view-new-name');
  const name = (input?.value || '').trim();
  if (!name) return;
  try {
    const resp = await fetch('/api/teams', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (resp.ok) {
      input.value = '';
      renderTeamsView();
    }
  } catch (err) { /* ignore */ }
}

async function confirmDeleteTeamView(teamId, name) {
  if (!confirm(`Delete team "${name}"? All members will lose access.`)) return;
  try {
    await fetch(`/api/teams/${teamId}`, { method: 'DELETE', headers: _authHeaders() });
    renderTeamsView();
  } catch (err) { /* ignore */ }
}

async function showTeamDetailView(teamId) {
  const container = document.getElementById('teams-view-content');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-10 text-dim"><div class="spinner"></div></div>';
  const formEl = document.getElementById('teams-view-create-form');
  if (formEl) formEl.innerHTML = '';
  try {
    const [teamResp, expResp, ownExpResp, chatResp, todosResp] = await Promise.all([
      fetch(`/api/teams/${teamId}`, { headers: _authHeaders() }),
      fetch('/api/team-experiments', { headers: _authHeaders() }),
      fetch('/api/experiments', { headers: _authHeaders() }),
      fetch(`/api/teams/${teamId}/messages`, { headers: _authHeaders() }),
      fetch(`/api/teams/${teamId}/todos`, { headers: _authHeaders() }),
    ]);
    const team = await teamResp.json();
    const allTeamExps = expResp.ok ? await expResp.json() : [];
    const ownExps = ownExpResp.ok ? await ownExpResp.json() : [];
    const chatMessages = chatResp.ok ? await chatResp.json() : [];
    const teamTodos = todosResp.ok ? await todosResp.json() : [];
    const isOwner = team.owner_google_id === (_authUserInfo && _authUserInfo.google_id);

    // Merge: team experiments for this team + own experiments assigned to this team
    const seen = new Set();
    const teamExps = [];
    for (const e of allTeamExps) {
      if (e.team_id === teamId && !seen.has(e.id)) { seen.add(e.id); teamExps.push(e); }
    }
    for (const e of ownExps) {
      if (e.team_id === teamId && !seen.has(e.id)) { seen.add(e.id); teamExps.push(e); }
    }

    const experimentsHtml = teamExps.length ? `
      <div class="mb-6">
        <h4 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Experiments</h4>
        <div class="grid grid-cols-1 gap-2">
          ${teamExps.map(exp => `
            <a href="#experiment/${exp.id}" class="flex items-center gap-3 p-3 rounded-lg border border-border-card bg-card hover:border-border-input transition-colors" style="text-decoration:none">
              ${typeof _pixelArt === 'function' ? _pixelArt(exp.id) : ''}
              <div class="min-w-0 flex-1">
                <div class="text-primary text-sm font-medium truncate">${escapeHtml(exp.title || exp.id)}</div>
                <div class="text-dimmer text-[0.72rem]">${exp.runCount || 0} run${(exp.runCount || 0) !== 1 ? 's' : ''}${exp.lastUpdated ? ' · ' + new Date(exp.lastUpdated).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : ''}</div>
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    ` : `
      <div class="mb-6">
        <h4 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Experiments</h4>
        <div class="text-dimmer text-xs">No experiments shared with this team yet. Assign a team to an experiment from the experiment detail page.</div>
      </div>
    `;

    const priorityColors = { high: '#f87171', medium: '#fbbf24', low: '#6ee7b7' };
    const priorityLabels = { high: 'High', medium: 'Med', low: 'Low' };
    const openTodos = teamTodos.filter(t => !t.done);
    const doneTodos = teamTodos.filter(t => t.done);
    const memberOpts = team.members.map(m => `<option value="${escapeAttr(m.google_id)}">${escapeHtml(m.username || 'unknown')}</option>`).join('');

    const todosHtml = `
      <div class="mb-6">
        <h4 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Tasks</h4>
        <div id="team-todos-list-${teamId}">
          ${openTodos.length ? openTodos.map(todo => `
            <div class="flex items-start gap-2.5 p-3 bg-card border border-border-card rounded-lg mb-1.5 group">
              <input type="checkbox" onchange="toggleTeamTodo(${teamId}, '${todo.id}', this.checked)" class="mt-0.5 accent-[var(--accent)] cursor-pointer" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-primary text-sm">${escapeHtml(todo.title)}</span>
                  <span class="text-[0.6rem] px-1.5 py-0.5 rounded-full font-medium" style="background:${priorityColors[todo.priority]}20;color:${priorityColors[todo.priority]}">${priorityLabels[todo.priority]}</span>
                </div>
                ${todo.description ? `<div class="text-dimmer text-xs mt-0.5">${escapeHtml(todo.description)}</div>` : ''}
                <div class="text-dimmest text-[0.65rem] mt-1 flex items-center gap-2">
                  <span>${escapeHtml(todo.author)}</span>
                  <span class="text-dimmer">→</span>
                  <select onchange="assignTeamTodo(${teamId}, '${todo.id}', this.value)" class="bg-transparent border-none text-[0.65rem] text-dimmest cursor-pointer outline-none p-0" style="appearance:auto">
                    <option value="">Unassigned</option>
                    ${team.members.map(m => `<option value="${escapeAttr(m.google_id)}" ${todo.assigned_to === m.google_id ? 'selected' : ''}>${escapeHtml(m.username || 'unknown')}</option>`).join('')}
                  </select>
                </div>
              </div>
              <button onclick="deleteTeamTodo(${teamId}, '${todo.id}')" class="text-red-400/40 hover:text-red-400 text-xs cursor-pointer bg-transparent border-none opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
            </div>
          `).join('') : '<div class="text-dimmer text-xs mb-2">No open tasks</div>'}
          ${doneTodos.length ? `
            <details class="mt-2">
              <summary class="text-dimmest text-[0.7rem] cursor-pointer hover:text-muted">${doneTodos.length} completed</summary>
              <div class="mt-1.5">
                ${doneTodos.map(todo => `
                  <div class="flex items-start gap-2.5 p-2.5 bg-card/50 border border-border-card/50 rounded-lg mb-1 opacity-50">
                    <input type="checkbox" checked onchange="toggleTeamTodo(${teamId}, '${todo.id}', this.checked)" class="mt-0.5 accent-[var(--accent)] cursor-pointer" />
                    <span class="text-primary text-sm line-through flex-1">${escapeHtml(todo.title)}</span>
                    <button onclick="deleteTeamTodo(${teamId}, '${todo.id}')" class="text-red-400/40 hover:text-red-400 text-xs cursor-pointer bg-transparent border-none">✕</button>
                  </div>
                `).join('')}
              </div>
            </details>
          ` : ''}
        </div>
        <div class="flex gap-2 mt-2">
          <input type="text" id="team-todo-title-${teamId}" placeholder="New task..." class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addTeamTodo(${teamId})}">
          <select id="team-todo-assign-${teamId}" class="bg-input border border-border-input rounded-md px-2 py-1.5 text-primary text-xs outline-none focus:border-accent cursor-pointer">
            <option value="">Assign to...</option>
            ${memberOpts}
          </select>
          <select id="team-todo-priority-${teamId}" class="bg-input border border-border-input rounded-md px-2 py-1.5 text-primary text-xs outline-none focus:border-accent cursor-pointer">
            <option value="medium">Med</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
          <button onclick="addTeamTodo(${teamId})" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Add</button>
        </div>
      </div>
    `;

    container.innerHTML = `
      <div class="mb-4">
        <button onclick="renderTeamsView()" class="text-xs text-muted hover:text-primary cursor-pointer bg-transparent border-none">&larr; Back to teams</button>
      </div>
      <div class="flex items-center gap-3 mb-6">
        <div class="w-12 h-12 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-xl font-bold">${escapeHtml(team.name[0].toUpperCase())}</div>
        <div>
          <div class="text-white_ text-lg font-semibold">${escapeHtml(team.name)}</div>
          <div class="text-dimmer text-xs">${team.members.length} member${team.members.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      ${experimentsHtml}
      ${todosHtml}
      <div class="mb-6">
        <h4 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Members</h4>
        ${team.members.map(m => `
          <div class="flex items-center justify-between py-2.5 px-1 border-b border-border-subtle last:border-0">
            <div class="flex items-center gap-2.5">
              ${m.picture
                ? `<img src="${escapeAttr(m.picture)}" class="w-7 h-7 rounded-full" referrerpolicy="no-referrer" />`
                : `<div class="w-7 h-7 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold">${escapeHtml((m.username || '?')[0].toUpperCase())}</div>`
              }
              <a href="#profile/${encodeURIComponent(m.username || 'unknown')}" class="text-primary text-sm hover:text-accent" style="text-decoration:none">${escapeHtml(m.username || 'unknown')}</a>
              ${m.role === 'owner' ? '<span class="text-accent text-[0.65rem] font-medium ml-1">owner</span>' : ''}
            </div>
            ${isOwner && m.role !== 'owner' ? `<button onclick="removeTeamMemberView(${teamId}, '${m.google_id}')" class="text-xs text-red-400/60 hover:text-red-400 cursor-pointer bg-transparent border-none">Remove</button>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="mb-6">
        <h4 class="text-muted text-xs font-semibold mb-2 uppercase tracking-wide">Invite Member</h4>
        <div class="flex gap-2">
          <input type="text" id="teams-view-invite-${teamId}" placeholder="Username" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();inviteToTeamView(${teamId})}">
          <button onclick="inviteToTeamView(${teamId})" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Invite</button>
        </div>
        <div id="teams-view-invite-msg-${teamId}" class="text-xs mt-1.5 h-4"></div>
      </div>
      <div>
        <h4 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Team Chat</h4>
        <div id="team-chat-messages-${teamId}" class="max-h-[400px] overflow-y-auto mb-3 flex flex-col gap-2">
          ${chatMessages.length ? chatMessages.map(m => {
            const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(m.timestamp) : '';
            const currentUser = _authUserInfo && _authUserInfo.username;
            const isOwn = m.username === currentUser;
            const ownActions = isOwn ? `<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-1 ${isOwn ? 'flex-row-reverse' : ''}">
              <button onclick="editTeamChatMsg(${teamId}, '${m.id}', this)" class="text-[0.6rem] text-dimmest hover:text-primary bg-transparent border-none cursor-pointer p-0">edit</button>
              <button onclick="deleteTeamChatMsg(${teamId}, '${m.id}')" class="text-[0.6rem] text-dimmest hover:text-red-400 bg-transparent border-none cursor-pointer p-0">delete</button>
            </div>` : '';
            return `<div class="flex items-start gap-2 group ${isOwn ? 'flex-row-reverse' : ''}">
              ${m.picture
                ? `<img src="${escapeAttr(m.picture)}" class="w-6 h-6 rounded-full shrink-0" referrerpolicy="no-referrer" />`
                : `<div class="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[0.6rem] font-bold shrink-0">${escapeHtml((m.username || '?')[0].toUpperCase())}</div>`
              }
              <div class="${isOwn ? 'bg-accent/15 border-accent/20' : 'bg-card border-border-card'} border rounded-lg px-3 py-2 max-w-[75%]">
                <div class="flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}">
                  <a href="#profile/${encodeURIComponent(m.username)}" class="text-[0.72rem] font-medium text-primary hover:text-accent" style="text-decoration:none">${escapeHtml(m.username)}</a>
                  <span class="text-[0.65rem] text-dimmest">${timeAgo}</span>
                  ${m.edited ? '<span class="text-[0.6rem] text-dimmest italic">(edited)</span>' : ''}
                </div>
                <div class="text-[0.8rem] text-primary mt-0.5 leading-relaxed" id="chat-msg-content-${m.id}" data-raw="${escapeAttr(m.content)}">${_renderChatContent(m.content)}</div>
                ${ownActions}
              </div>
            </div>`;
          }).join('') : '<div class="text-dimmer text-xs text-center py-4">No messages yet. Start the conversation!</div>'}
        </div>
        <div class="flex gap-2">
          <input type="text" id="team-chat-input-${teamId}" placeholder="Type a message..." class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();sendTeamChatMessage(${teamId})}">
          <button onclick="sendTeamChatMessage(${teamId})" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Send</button>
        </div>
      </div>
    `;
    // Scroll chat to bottom
    setTimeout(() => {
      const chatEl = document.getElementById('team-chat-messages-' + teamId);
      if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    }, 50);
  } catch (err) {
    container.innerHTML = `<div class="text-center py-10 text-red-400 text-sm">Failed to load team</div>`;
  }
}

async function sendTeamChatMessage(teamId) {
  const input = document.getElementById(`team-chat-input-${teamId}`);
  const content = (input?.value || '').trim();
  if (!content) return;
  try {
    const res = await fetch(`/api/teams/${teamId}/messages`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      input.value = '';
      // Append the new message inline instead of reloading everything
      const msg = await res.json();
      const chatEl = document.getElementById(`team-chat-messages-${teamId}`);
      if (chatEl) {
        // Remove empty state if present
        const empty = chatEl.querySelector('.text-center.py-4');
        if (empty) empty.remove();
        const currentUser = _authUserInfo && _authUserInfo.username;
        const pic = _authUserInfo && _authUserInfo.picture;
        const div = document.createElement('div');
        div.className = 'flex items-start gap-2 flex-row-reverse';
        div.innerHTML = `
          ${pic
            ? `<img src="${escapeAttr(pic)}" class="w-6 h-6 rounded-full shrink-0" referrerpolicy="no-referrer" />`
            : `<div class="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[0.6rem] font-bold shrink-0">${escapeHtml((currentUser || '?')[0].toUpperCase())}</div>`
          }
          <div class="bg-accent/15 border-accent/20 border rounded-lg px-3 py-2 max-w-[75%]">
            <div class="flex items-center gap-1.5 flex-row-reverse">
              <span class="text-[0.72rem] font-medium text-primary">${escapeHtml(currentUser)}</span>
              <span class="text-[0.65rem] text-dimmest">just now</span>
            </div>
            <div class="text-[0.8rem] text-primary mt-0.5 leading-relaxed">${_renderChatContent(content)}</div>
          </div>
        `;
        chatEl.appendChild(div);
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    }
  } catch (err) { /* ignore */ }
}

function editTeamChatMsg(teamId, msgId, btn) {
  const contentEl = document.getElementById(`chat-msg-content-${msgId}`);
  if (!contentEl) return;
  const bubble = contentEl.closest('.border.rounded-lg');
  const rawContent = contentEl.dataset.raw || contentEl.textContent.trim();
  // Replace content with inline edit
  const actionsDiv = bubble.querySelector('.group-hover\\:opacity-100');
  if (actionsDiv) actionsDiv.style.display = 'none';
  const rows = Math.max(2, rawContent.split('\n').length);
  contentEl.innerHTML = `
    <textarea id="chat-msg-edit-${msgId}" class="w-full bg-input border border-border-input rounded px-2 py-1 text-[0.8rem] text-primary resize-none outline-none focus:border-accent font-mono" rows="${rows}">${escapeHtml(rawContent)}</textarea>
    <div class="flex gap-1.5 mt-1">
      <button onclick="saveTeamChatMsg(${teamId}, '${msgId}')" class="text-[0.68rem] px-2 py-0.5 rounded bg-accent text-white border-none cursor-pointer">Save</button>
      <button onclick="showTeamDetailView(${teamId})" class="text-[0.68rem] px-2 py-0.5 rounded border border-border-input text-muted bg-transparent cursor-pointer">Cancel</button>
    </div>
  `;
  const ta = document.getElementById(`chat-msg-edit-${msgId}`);
  if (ta) { ta.focus(); ta.selectionStart = ta.value.length; }
}

async function saveTeamChatMsg(teamId, msgId) {
  const ta = document.getElementById(`chat-msg-edit-${msgId}`);
  const content = (ta?.value || '').trim();
  if (!content) return;
  try {
    await fetch(`/api/teams/${teamId}/messages/${msgId}`, {
      method: 'PUT',
      headers: _authHeaders(),
      body: JSON.stringify({ content })
    });
    showTeamDetailView(teamId);
  } catch (err) { /* ignore */ }
}

async function deleteTeamChatMsg(teamId, msgId) {
  if (!confirm('Delete this message?')) return;
  try {
    await fetch(`/api/teams/${teamId}/messages/${msgId}`, {
      method: 'DELETE',
      headers: _authHeaders()
    });
    showTeamDetailView(teamId);
  } catch (err) { /* ignore */ }
}

async function addTeamTodo(teamId) {
  const input = document.getElementById(`team-todo-title-${teamId}`);
  const priorityEl = document.getElementById(`team-todo-priority-${teamId}`);
  const assignEl = document.getElementById(`team-todo-assign-${teamId}`);
  const title = (input?.value || '').trim();
  if (!title) return;
  const body = { title, priority: priorityEl?.value || 'medium' };
  if (assignEl?.value) body.assigned_to = assignEl.value;
  try {
    const resp = await fetch(`/api/teams/${teamId}/todos`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify(body)
    });
    if (resp.ok) {
      input.value = '';
      if (assignEl) assignEl.value = '';
      showTeamDetailView(teamId);
    }
  } catch (err) { /* ignore */ }
}

async function assignTeamTodo(teamId, todoId, assignedTo) {
  try {
    await fetch(`/api/teams/${teamId}/todos/${todoId}`, {
      method: 'PUT',
      headers: _authHeaders(),
      body: JSON.stringify({ assigned_to: assignedTo || null })
    });
  } catch (err) { /* ignore */ }
}

async function toggleTeamTodo(teamId, todoId, done) {
  try {
    await fetch(`/api/teams/${teamId}/todos/${todoId}`, {
      method: 'PUT',
      headers: _authHeaders(),
      body: JSON.stringify({ done })
    });
    showTeamDetailView(teamId);
  } catch (err) { /* ignore */ }
}

async function deleteTeamTodo(teamId, todoId) {
  try {
    await fetch(`/api/teams/${teamId}/todos/${todoId}`, {
      method: 'DELETE',
      headers: _authHeaders()
    });
    showTeamDetailView(teamId);
  } catch (err) { /* ignore */ }
}

async function removeTeamMemberView(teamId, googleId) {
  if (!confirm('Remove this member from the team?')) return;
  try {
    await fetch(`/api/teams/${teamId}/remove`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_id: googleId })
    });
    showTeamDetailView(teamId);
  } catch (err) { /* ignore */ }
}

async function inviteToTeamView(teamId) {
  const input = document.getElementById(`teams-view-invite-${teamId}`);
  const msg = document.getElementById(`teams-view-invite-msg-${teamId}`);
  const username = (input?.value || '').trim();
  if (!username) return;
  try {
    const resp = await fetch(`/api/teams/${teamId}/invite`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await resp.json();
    if (data.error) {
      if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = data.error; }
    } else {
      if (msg) { msg.style.color = 'var(--accent)'; msg.textContent = 'Invite sent!'; }
      input.value = '';
    }
  } catch (err) {
    if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = 'Failed to send invite'; }
  }
}

// ── Teams Section (for settings) ──

async function fetchTeams() {
  try {
    const resp = await fetch('/api/teams', { headers: _authHeaders() });
    _cachedTeams = await resp.json();
  } catch (err) {
    _cachedTeams = [];
  }
  return _cachedTeams;
}

function renderTeamsSection() {
  const container = document.getElementById('teams-section-content');
  if (!container) return;

  if (!_cachedTeams.length) {
    container.innerHTML = '<div class="text-dimmer text-xs mb-3">No teams yet</div>';
  } else {
    container.innerHTML = _cachedTeams.map(t => `
      <div class="flex items-center justify-between p-3 bg-card border border-border-card rounded-lg mb-2 group">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">${escapeHtml(t.name[0].toUpperCase())}</div>
          <div>
            <div class="text-primary text-sm font-medium">${escapeHtml(t.name)}</div>
            <div class="text-dimmer text-xs">${t.member_count} member${t.member_count !== 1 ? 's' : ''} · ${t.role}</div>
          </div>
        </div>
        <div class="flex gap-1.5">
          <button onclick="showTeamDetail(${t.id})" class="px-2 py-1 rounded text-xs border border-border-input text-muted bg-transparent cursor-pointer hover:text-primary transition-colors">Manage</button>
          ${t.role === 'owner' ? `<button onclick="confirmDeleteTeam(${t.id}, '${escapeAttr(t.name)}')" class="px-2 py-1 rounded text-xs border border-red-800/50 text-red-400/70 bg-transparent cursor-pointer hover:text-red-400 transition-colors">Delete</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  // Create team form
  const formEl = document.getElementById('create-team-form');
  if (formEl) formEl.innerHTML = `
    <div class="flex gap-2 mt-3">
      <input type="text" id="new-team-name" placeholder="Team name" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();createTeamFromForm()}">
      <button onclick="createTeamFromForm()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Create</button>
    </div>
  `;
}

async function createTeamFromForm() {
  const input = document.getElementById('new-team-name');
  const name = (input?.value || '').trim();
  if (!name) return;
  try {
    const resp = await fetch('/api/teams', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (resp.ok) {
      input.value = '';
      await fetchTeams();
      renderTeamsSection();
    }
  } catch (err) { /* ignore */ }
}

async function confirmDeleteTeam(teamId, name) {
  if (!confirm(`Delete team "${name}"? All members will lose access.`)) return;
  try {
    await fetch(`/api/teams/${teamId}`, {
      method: 'DELETE',
      headers: _authHeaders()
    });
    await fetchTeams();
    renderTeamsSection();
  } catch (err) { /* ignore */ }
}

async function showTeamDetail(teamId) {
  const container = document.getElementById('teams-section-content');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-4 text-dim"><div class="spinner"></div></div>';
  try {
    const resp = await fetch(`/api/teams/${teamId}`, { headers: _authHeaders() });
    const team = await resp.json();
    const isOwner = team.owner_google_id === _authUserInfo?.google_id;

    container.innerHTML = `
      <div class="mb-3">
        <button onclick="fetchTeams().then(()=>renderTeamsSection())" class="text-xs text-muted hover:text-primary cursor-pointer bg-transparent border-none">&larr; Back to teams</button>
      </div>
      <div class="flex items-center gap-2 mb-4">
        <div class="w-10 h-10 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">${escapeHtml(team.name[0].toUpperCase())}</div>
        <div>
          <div class="text-white_ text-base font-semibold">${escapeHtml(team.name)}</div>
          <div class="text-dimmer text-xs">${team.members.length} member${team.members.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="mb-4">
        <h4 class="text-muted text-xs font-semibold mb-2 uppercase tracking-wide">Members</h4>
        ${team.members.map(m => `
          <div class="flex items-center justify-between py-2 px-1 border-b border-border-subtle last:border-0">
            <div class="flex items-center gap-2">
              ${m.picture
                ? `<img src="${escapeAttr(m.picture)}" class="w-6 h-6 rounded-full" referrerpolicy="no-referrer" />`
                : `<div class="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold">${escapeHtml((m.username || '?')[0].toUpperCase())}</div>`
              }
              <a href="#profile/${encodeURIComponent(m.username || 'unknown')}" class="text-primary text-sm hover:text-accent" style="text-decoration:none">${escapeHtml(m.username || 'unknown')}</a>
              ${m.role === 'owner' ? '<span class="text-accent text-[0.65rem] font-medium ml-1">owner</span>' : ''}
            </div>
            ${isOwner && m.role !== 'owner' ? `<button onclick="removeTeamMember(${teamId}, '${m.google_id}')" class="text-xs text-red-400/60 hover:text-red-400 cursor-pointer bg-transparent border-none">Remove</button>` : ''}
          </div>
        `).join('')}
      </div>
      <div>
        <h4 class="text-muted text-xs font-semibold mb-2 uppercase tracking-wide">Invite Member</h4>
        <div class="flex gap-2">
          <input type="text" id="invite-username-${teamId}" placeholder="Username" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();inviteToTeam(${teamId})}">
          <button onclick="inviteToTeam(${teamId})" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Invite</button>
        </div>
        <div id="invite-msg-${teamId}" class="text-xs mt-1.5 h-4"></div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<div class="text-red-400 text-sm">Failed to load team</div>';
  }
}

async function inviteToTeam(teamId) {
  const input = document.getElementById(`invite-username-${teamId}`);
  const msg = document.getElementById(`invite-msg-${teamId}`);
  const username = (input?.value || '').trim();
  if (!username) return;
  try {
    const resp = await fetch(`/api/teams/${teamId}/invite`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await resp.json();
    if (data.error) {
      if (msg) { msg.style.color = 'var(--text-red-400, #f87171)'; msg.textContent = data.error; }
    } else {
      if (msg) { msg.style.color = 'var(--accent)'; msg.textContent = 'Invite sent!'; }
      if (input) input.value = '';
    }
  } catch (err) {
    if (msg) { msg.style.color = 'var(--text-red-400, #f87171)'; msg.textContent = 'Failed to send invite'; }
  }
}

async function removeTeamMember(teamId, googleId) {
  if (!confirm('Remove this member from the team?')) return;
  try {
    await fetch(`/api/teams/${teamId}/remove`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_id: googleId })
    });
    showTeamDetail(teamId);
  } catch (err) { /* ignore */ }
}

// ── Experiment Team Picker ──

async function renderTeamPicker(experimentId) {
  const container = document.getElementById('exp-team-picker');
  if (!container) return;

  if (!_cachedTeams.length) await fetchTeams();
  if (!_cachedTeams.length) {
    container.innerHTML = '';
    return;
  }

  // Find current team from team experiments list
  let currentTeamId = null;
  const teamExp = (_teamExperiments || []).find(e => e.id === experimentId);
  if (teamExp) currentTeamId = teamExp.team_id;

  const currentTeam = currentTeamId ? _cachedTeams.find(t => t.id === currentTeamId) : null;
  const teamLabel = currentTeam
    ? `<span class="inline-flex items-center gap-1 text-[0.72rem] text-accent bg-accent/10 border border-accent/20 rounded-full px-2 py-0.5 mr-1.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>${escapeHtml(currentTeam.name)}</span>`
    : '';
  container.innerHTML = `
    ${teamLabel}
    <select id="exp-team-select" class="bg-input border border-border-input rounded-md px-2 py-1 text-primary text-xs outline-none focus:border-accent cursor-pointer" onchange="assignExperimentTeam('${experimentId}', this.value)">
      <option value="">No team</option>
      ${_cachedTeams.map(t => `<option value="${t.id}" ${currentTeamId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
    </select>
  `;
}

async function assignExperimentTeam(experimentId, teamId) {
  try {
    if (teamId) {
      await fetch(`/api/experiments/${experimentId}/team`, {
        method: 'PUT',
        headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: parseInt(teamId) })
      });
      // Update local cache so re-render picks up the team
      const idx = (_teamExperiments || []).findIndex(e => e.id === experimentId);
      if (idx >= 0) _teamExperiments[idx].team_id = parseInt(teamId);
      else if (typeof _teamExperiments !== 'undefined') _teamExperiments.push({ id: experimentId, team_id: parseInt(teamId) });
    } else {
      await fetch(`/api/experiments/${experimentId}/team`, {
        method: 'DELETE',
        headers: _authHeaders()
      });
      if (typeof _teamExperiments !== 'undefined') {
        const idx = _teamExperiments.findIndex(e => e.id === experimentId);
        if (idx >= 0) _teamExperiments.splice(idx, 1);
      }
    }
    renderTeamPicker(experimentId);
  } catch (err) { /* ignore */ }
}
