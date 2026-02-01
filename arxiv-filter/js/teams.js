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
              <span class="text-primary text-sm">${escapeHtml(m.username || 'unknown')}</span>
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

  container.innerHTML = `
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
    } else {
      await fetch(`/api/experiments/${experimentId}/team`, {
        method: 'DELETE',
        headers: _authHeaders()
      });
    }
  } catch (err) { /* ignore */ }
}
