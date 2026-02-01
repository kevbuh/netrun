// ── Teams & Inbox ──

let _cachedTeams = [];
let _cachedInvites = [];

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
    const resp = await fetch('/api/inbox', { headers: _authHeaders() });
    _cachedInvites = await resp.json();
    if (!_cachedInvites.length) {
      container.innerHTML = '<div class="text-center py-20 text-dim text-sm">No pending invites</div>';
      return;
    }
    container.innerHTML = _cachedInvites.map(inv => `
      <div class="flex items-center justify-between p-4 bg-card border border-border-card rounded-lg mb-2">
        <div>
          <div class="text-primary text-sm font-medium">${escapeHtml(inv.from_username)} invited you to <span class="text-accent font-semibold">${escapeHtml(inv.team_name)}</span></div>
          <div class="text-dimmer text-xs mt-0.5">${inv.created || ''}</div>
        </div>
        <div class="flex gap-2">
          <button onclick="respondToInvite(${inv.id}, true)" class="px-3 py-1 rounded-md text-xs bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Accept</button>
          <button onclick="respondToInvite(${inv.id}, false)" class="px-3 py-1 rounded-md text-xs border border-border-input text-muted bg-card cursor-pointer hover:text-primary transition-colors">Decline</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-center py-20 text-red-400 text-sm">Failed to load inbox</div>`;
  }
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
    const resp = await fetch('/api/inbox', { headers: _authHeaders() });
    const invites = await resp.json();
    const badge = document.getElementById('inbox-badge');
    if (badge) {
      if (invites.length > 0) {
        badge.textContent = invites.length;
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
    const [teamResp, expResp, ownExpResp] = await Promise.all([
      fetch(`/api/teams/${teamId}`, { headers: _authHeaders() }),
      fetch('/api/team-experiments', { headers: _authHeaders() }),
      fetch('/api/experiments', { headers: _authHeaders() }),
    ]);
    const team = await teamResp.json();
    const allTeamExps = expResp.ok ? await expResp.json() : [];
    const ownExps = ownExpResp.ok ? await ownExpResp.json() : [];
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
      <div>
        <h4 class="text-muted text-xs font-semibold mb-2 uppercase tracking-wide">Invite Member</h4>
        <div class="flex gap-2">
          <input type="text" id="teams-view-invite-${teamId}" placeholder="Username" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();inviteToTeamView(${teamId})}">
          <button onclick="inviteToTeamView(${teamId})" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Invite</button>
        </div>
        <div id="teams-view-invite-msg-${teamId}" class="text-xs mt-1.5 h-4"></div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="text-center py-10 text-red-400 text-sm">Failed to load team</div>`;
  }
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
