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

function _renderFileRef(expId, filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const langColors = { py: '#3572A5', js: '#f1e05a', ts: '#3178c6', md: '#083fa1', tex: '#3D6117', css: '#563d7c', html: '#e34c26', json: '#292929', ipynb: '#DA5B0B', sh: '#89e051' };
  const color = langColors[ext] || 'var(--accent)';
  const uid = 'fref-' + Math.random().toString(36).slice(2, 10);
  // Lazy-load preview
  setTimeout(async () => {
    const el = document.getElementById(uid);
    if (!el) return;
    try {
      const resp = await fetch(`/api/experiments/${encodeURIComponent(expId)}/files/${encodeURIComponent(filePath)}`, { headers: _authHeaders() });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.binary) { el.textContent = '(binary file)'; return; }
      const lines = (data.content || '').split('\n').slice(0, 8);
      el.textContent = lines.join('\n') + (data.content.split('\n').length > 8 ? '\n…' : '');
    } catch { el.textContent = '(could not load preview)'; }
  }, 50);
  const expLabel = expId.replace(/-/g, ' ');
  return `<a href="#experiment/${encodeURIComponent(expId)}?file=${encodeURIComponent(filePath)}" style="text-decoration:none;display:block" onclick="event.stopPropagation()">
    <div style="background:var(--bg-body);border:1px solid var(--border-card);border-radius:8px;padding:10px 12px;margin-top:4px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="font-size:0.8rem;color:var(--text-primary);font-weight:500">${escapeHtml(filePath)}</span>
        <span style="font-size:0.6rem;color:var(--text-dimmest);text-transform:uppercase;font-weight:600">${escapeHtml(ext)}</span>
      </div>
      <div style="font-size:0.65rem;color:var(--text-dimmest);margin-bottom:6px">${escapeHtml(expLabel)}</div>
      <pre id="${uid}" style="font-size:0.7rem;color:var(--text-muted);background:var(--bg-input);border-radius:6px;padding:8px;margin:0;overflow-x:auto;max-height:160px;line-height:1.4;white-space:pre-wrap;word-break:break-all"><span style="color:var(--text-dimmest)">loading…</span></pre>
    </div>
  </a>`;
}

function _renderChatContent(content) {
  // File references: [file:expId/path]
  const fileRefRe = /\[file:([a-zA-Z0-9_-]+)\/(.+?)\]/g;
  if (fileRefRe.test(content)) {
    // Could be mixed text + file refs
    fileRefRe.lastIndex = 0;
    let result = '';
    let lastIdx = 0;
    let m;
    while ((m = fileRefRe.exec(content)) !== null) {
      const before = content.slice(lastIdx, m.index);
      if (before.trim()) result += escapeHtml(before);
      result += _renderFileRef(m[1], m[2]);
      lastIdx = m.index + m[0].length;
    }
    const after = content.slice(lastIdx);
    if (after.trim()) result += escapeHtml(after);
    return result;
  }

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

// ── Emoji Reactions ──

const REACTION_EMOJIS = ['👍','👎','❤️','😂','😮','😢','🎉','🚀','👀','🔥','💯','✅','❌','🤔','👏','💪','🙏','⭐','💡','🎯'];

function renderReactionsRow(teamId, msgId, reactions) {
  const currentGid = _authUserInfo && _authUserInfo.google_id;
  let html = '';
  for (const r of reactions) {
    const hasOwn = r.users.some(u => u.google_id === currentGid);
    const cls = hasOwn ? 'border-accent bg-accent/10 text-primary' : 'bg-transparent border-border-input text-muted hover:border-accent';
    const title = r.users.map(u => u.username).join(', ');
    html += `<button onclick="toggleReaction(${teamId}, '${msgId}', '${r.emoji}')" title="${escapeAttr(title)}"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border cursor-pointer transition-colors ${cls}"
      style="line-height:1.4">${r.emoji} <span>${r.count}</span></button>`;
  }
  html += `<button onclick="showEmojiPicker(${teamId}, '${msgId}', this)"
    class="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs border border-border-input text-dimmest bg-transparent cursor-pointer hover:border-accent hover:text-muted transition-colors"
    title="Add reaction">+</button>`;
  return html;
}

async function toggleReaction(teamId, msgId, emoji) {
  try {
    const resp = await fetch(`/api/teams/${teamId}/messages/${msgId}/reactions`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ emoji })
    });
    if (resp.ok) {
      const data = await resp.json();
      const row = document.getElementById(`chat-reactions-${msgId}`);
      if (row) row.innerHTML = renderReactionsRow(teamId, msgId, data.reactions);
    }
  } catch (err) { /* ignore */ }
}

function showEmojiPicker(teamId, msgId, btn) {
  // Remove existing picker
  const existing = document.getElementById('emoji-reaction-picker');
  if (existing) { existing.remove(); return; }

  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.id = 'emoji-reaction-picker';
  dd.style.cssText = `position:fixed;z-index:10001;background:var(--bg-card);border:1px solid var(--border-card);border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.3);display:grid;grid-template-columns:repeat(5,1fr);gap:2px;width:180px`;
  // Position above button
  dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  dd.style.left = Math.min(rect.left, window.innerWidth - 190) + 'px';

  dd.innerHTML = REACTION_EMOJIS.map(e =>
    `<button onclick="toggleReaction(${teamId}, '${msgId}', '${e}'); document.getElementById('emoji-reaction-picker')?.remove()"
      class="w-8 h-8 flex items-center justify-center rounded cursor-pointer bg-transparent border-none text-base hover:bg-accent/10 transition-colors">${e}</button>`
  ).join('');
  document.body.appendChild(dd);

  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Inbox View ──

function openInbox() {
  setSidebarLoading('sb-inbox');
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
    const [invResp, msgResp, tasksResp, chatsResp] = await Promise.all([
      fetch('/api/inbox', { headers: _authHeaders() }),
      fetch('/api/messages', { headers: _authHeaders() }),
      fetch('/api/my-tasks', { headers: _authHeaders() }),
      fetch('/api/inbox-chats', { headers: _authHeaders() }),
    ]);
    _cachedInvites = await invResp.json();
    const messages = msgResp.ok ? await msgResp.json() : [];
    const tasks = tasksResp.ok ? await tasksResp.json() : [];
    const chats = chatsResp.ok ? await chatsResp.json() : [];

    const feedNotifs = typeof _getFeedNotifications === 'function' ? _getFeedNotifications() : [];
    const dismissedTasks = JSON.parse(localStorage.getItem('dismissedInboxTasks') || '[]');
    const filteredTasks = tasks.filter(t => !dismissedTasks.includes(t.id));

    if (!_cachedInvites.length && !messages.length && !filteredTasks.length && !chats.length && !feedNotifs.length) {
      container.innerHTML = `<div class="py-10 max-w-md mx-auto">
        <div class="p-4 bg-card border border-border-card rounded-lg">
          <div class="text-[0.88rem] text-primary">Hello! Welcome to your inbox. New posts, invites, and messages will show up here.</div>
        </div>
      </div>`;
      return;
    }

    let html = '';

    // New Posts from feeds
    if (feedNotifs.length) {
      html += '<div class="flex items-center justify-between mb-2"><div class="text-[0.75rem] text-dim uppercase tracking-wide">New Posts</div><button onclick="clearAllFeedNotifications(); renderInbox()" class="text-[0.68rem] text-dimmer hover:text-accent bg-transparent border-none cursor-pointer">Dismiss all</button></div>';
      html += feedNotifs.slice().sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0)).slice(0, 20).map(n => {
        const sourceChip = typeof getSourceChip === 'function' ? getSourceChip(n.source) : `<span class="text-dim text-xs">${escapeHtml(n.source)}</span>`;
        return `
        <div class="flex items-center gap-2.5 p-3 bg-card border border-border-card rounded-lg mb-1.5 border-l-accent border-l-2 cursor-pointer hover:border-border-input transition-colors" onclick="clearFeedNotification('${escapeAttr(n.link)}'); _browseReturnView='inbox'; openBrowse('${escapeAttr(n.link)}')">
          <span class="w-2 h-2 rounded-full bg-accent shrink-0"></span>
          ${sourceChip}
          <span class="text-[0.82rem] text-primary truncate flex-1">${escapeHtml(n.title)}</span>
          ${n.date ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(n.date)}</span>` : ''}
          <button onclick="event.stopPropagation(); dismissFeedNotification('${escapeAttr(n.link)}', this)" class="text-dimmer hover:text-primary text-sm bg-transparent border-none cursor-pointer px-1 shrink-0" title="Dismiss">&times;</button>
        </div>`;
      }).join('');
      if (feedNotifs.length > 20) {
        html += `<div class="text-dimmer text-[0.7rem] text-center py-1">+${feedNotifs.length - 20} more</div>`;
      }
      html += '<div class="mb-5"></div>';
    }

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

    // Assigned Tasks
    if (filteredTasks.length) {
      html += '<div class="text-[0.75rem] text-dim uppercase tracking-wide mb-2 mt-5">Assigned Tasks</div>';
      html += filteredTasks.map(t => {
        const priColors = { high: 'text-red-400', medium: 'text-yellow-400', low: 'text-green-400' };
        const priColor = priColors[t.priority] || 'text-dim';
        return `
        <div class="flex items-center gap-3 p-4 bg-card border border-border-card rounded-lg mb-2 border-l-accent border-l-2 cursor-pointer" onclick="openTeams(); showTeamDetailView(${t.team_id})">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-primary">${escapeHtml(t.title)}</span>
              <span class="text-[0.65rem] ${priColor} uppercase font-semibold">${escapeHtml(t.priority)}</span>
            </div>
            <div class="text-dimmer text-xs mt-0.5">${escapeHtml(t.team_name)} · from ${escapeHtml(t.author)}</div>
          </div>
          <button onclick="event.stopPropagation(); dismissInboxTask('${escapeAttr(t.id)}', this)" class="text-dimmer hover:text-primary text-sm bg-transparent border-none cursor-pointer px-1 shrink-0" title="Dismiss">&times;</button>
        </div>`;
      }).join('');
    }

    // Team Chats (unread)
    if (chats.length) {
      html += '<div class="text-[0.75rem] text-dim uppercase tracking-wide mb-2 mt-5">Team Chat</div>';
      // Group by team
      const byTeam = {};
      for (const c of chats) {
        if (!byTeam[c.team_id]) byTeam[c.team_id] = { team_name: c.team_name, team_id: c.team_id, msgs: [] };
        byTeam[c.team_id].msgs.push(c);
      }
      for (const team of Object.values(byTeam)) {
        const latest = team.msgs[0];
        const count = team.msgs.length;
        html += `
        <div class="flex items-start gap-3 p-4 bg-card border border-border-card rounded-lg mb-2 border-l-accent border-l-2 cursor-pointer" onclick="openTeams(); showTeamDetailView(${team.team_id})">
          ${latest.picture
            ? `<img src="${escapeAttr(latest.picture)}" class="w-8 h-8 rounded-full shrink-0" referrerpolicy="no-referrer" />`
            : `<div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold shrink-0">${escapeHtml((latest.username || '?')[0].toUpperCase())}</div>`
          }
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-accent">${escapeHtml(team.team_name)}</span>
              <span class="text-dimmer text-[0.7rem]">${count} new message${count > 1 ? 's' : ''}</span>
              <span class="w-2 h-2 rounded-full bg-accent shrink-0"></span>
            </div>
            <div class="text-[0.82rem] text-primary mt-1 leading-relaxed truncate"><span class="text-dim">${escapeHtml(latest.username)}:</span> ${escapeHtml(latest.content.length > 80 ? latest.content.slice(0, 80) + '…' : latest.content)}</div>
          </div>
          <button onclick="event.stopPropagation(); dismissTeamChat(${team.team_id}, this)" class="text-dimmer hover:text-primary text-sm bg-transparent border-none cursor-pointer px-1 shrink-0 mt-1" title="Dismiss">&times;</button>
        </div>`;
      }
    }

    // Direct Messages
    if (messages.length) {
      html += '<div class="text-[0.75rem] text-dim uppercase tracking-wide mb-2 mt-5">Messages</div>';
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
          <button onclick="event.stopPropagation(); dismissDirectMessage('${escapeAttr(msg.id)}', this)" class="text-dimmer hover:text-primary text-sm bg-transparent border-none cursor-pointer px-1 shrink-0 mt-1" title="Delete">&times;</button>
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
      badge.dataset.serverCount = data.total || 0;
      const feedCount = typeof _getFeedNotifications === 'function' ? _getFeedNotifications().length : 0;
      const total = (data.total || 0) + feedCount;
      if (total > 0) {
        badge.textContent = total;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (err) { /* ignore */ }
}

function dismissFeedNotification(link, btn) {
  clearFeedNotification(link);
  const card = btn.closest('.flex');
  if (card) card.remove();
  refreshInboxBadge();
}

function dismissInboxTask(taskId, btn) {
  const dismissed = JSON.parse(localStorage.getItem('dismissedInboxTasks') || '[]');
  if (!dismissed.includes(taskId)) {
    dismissed.push(taskId);
    localStorage.setItem('dismissedInboxTasks', JSON.stringify(dismissed));
  }
  const card = btn.closest('.flex');
  if (card) card.remove();
}

async function dismissTeamChat(teamId, btn) {
  try {
    await fetch(`/api/teams/${teamId}/chat-read`, { method: 'POST', headers: _authHeaders() });
  } catch (err) { /* ignore */ }
  const card = btn.closest('.flex');
  if (card) card.remove();
  refreshInboxBadge();
}

async function dismissDirectMessage(msgId, btn) {
  try {
    await fetch(`/api/messages/${msgId}`, { method: 'DELETE', headers: _authHeaders() });
  } catch (err) { /* ignore */ }
  const card = btn.closest('.flex');
  if (card) card.remove();
  refreshInboxBadge();
}

// ── Teams View (standalone page) ──

function openTeams() {
  setSidebarLoading('sb-teams');
  hideAllViews();
  const view = document.getElementById('teams-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'teams';
  setSidebarActive('sb-teams');
  renderTeamsView();
}

async function renderTeamsView() {
  const listEl = document.getElementById('teams-view-list');
  const detailEl = document.getElementById('teams-view-detail');
  if (listEl) listEl.classList.remove('hidden');
  if (detailEl) detailEl.classList.add('hidden');
  const container = document.getElementById('teams-view-content');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';
  await fetchTeams();

  if (!_cachedTeams.length) {
    container.innerHTML = '<div class="text-dimmer text-sm mb-4">No teams yet. Create one to start collaborating.</div>';
  } else {
    const _lockSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;opacity:0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    container.innerHTML = _cachedTeams.map(t => `
      <div class="flex items-center justify-between p-4 bg-card border border-border-card rounded-lg mb-2 group cursor-pointer hover:border-border-input transition-colors" onclick="showTeamDetailView(${t.id})">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-base font-bold">${escapeHtml(t.name[0].toUpperCase())}</div>
          <div>
            <div class="text-primary text-sm font-medium">${escapeHtml(t.name)}${t.private ? ' ' + _lockSvg : ''}</div>
            <div class="text-dimmer text-xs">${t.member_count} member${t.member_count !== 1 ? 's' : ''} · ${escapeHtml(t.role)}</div>
          </div>
        </div>
        <div class="flex gap-1.5" onclick="event.stopPropagation()">
          ${t.role === 'owner' ? `<button onclick="confirmDeleteTeamView(${t.id}, '${escapeAttr(t.name)}')" class="px-2 py-1 rounded text-xs border border-red-800/50 text-red-400/70 bg-transparent cursor-pointer hover:text-red-400 transition-colors">Delete</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  // Clear form container — button is now in the heading
  const formEl = document.getElementById('teams-view-create-form');
  if (formEl) formEl.innerHTML = '';
}

let _createTeamPopupSource = null;

function showCreateTeamPopup(source) {
  // Remove existing popup
  const existing = document.getElementById('create-team-popup');
  if (existing) { existing.remove(); return; }

  _createTeamPopupSource = source;
  const parentOpts = _cachedTeams.filter(t => t.role === 'owner').map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'create-team-popup';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:var(--overlay-bg, rgba(0,0,0,0.4))';
  overlay.innerHTML = `
    <div class="bg-card border border-border-card rounded-xl shadow-xl" style="width:380px;max-width:90vw;padding:24px" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-white_ text-sm font-semibold">Create Team</h3>
        <button onclick="document.getElementById('create-team-popup')?.remove()" class="text-dimmer hover:text-primary bg-transparent border-none cursor-pointer text-lg leading-none">&times;</button>
      </div>
      <div class="flex flex-col gap-3">
        <input type="text" id="create-team-popup-name" placeholder="Team name" class="bg-input border border-border-input rounded-md px-3 py-2 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();submitCreateTeamPopup()}" autofocus>
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="text-dimmer text-[0.7rem] mb-1 block">Parent team</label>
            <select id="create-team-popup-parent" class="w-full bg-input border border-border-input rounded-md px-2 py-1.5 text-primary text-xs outline-none focus:border-accent cursor-pointer">
              <option value="">None</option>
              ${parentOpts}
            </select>
          </div>
          <div class="flex items-end pb-1">
            <label class="flex items-center gap-1.5 text-dimmer text-xs cursor-pointer whitespace-nowrap">
              <input type="checkbox" id="create-team-popup-private" class="accent-[var(--accent)]"> Private
            </label>
          </div>
        </div>
        <button onclick="submitCreateTeamPopup()" class="bg-accent text-white text-sm px-4 py-2 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors mt-1">Create</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('create-team-popup-name')?.focus(), 50);
}

async function submitCreateTeamPopup() {
  const input = document.getElementById('create-team-popup-name');
  const name = (input?.value || '').trim();
  if (!name) return;
  const privateCheck = document.getElementById('create-team-popup-private');
  const parentSelect = document.getElementById('create-team-popup-parent');
  const body = { name };
  if (privateCheck?.checked) body.private = true;
  if (parentSelect?.value) body.parent_id = parseInt(parentSelect.value);
  try {
    const resp = await fetch('/api/teams', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.ok) {
      document.getElementById('create-team-popup')?.remove();
      if (_createTeamPopupSource === 'view') {
        renderTeamsView();
      } else {
        await fetchTeams();
        renderTeamsSection();
      }
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

function toggleTeamSidebar() {
  const grid = document.querySelector('#teams-view-detail .grid');
  if (!grid) return;
  grid.classList.toggle('team-sidebar-collapsed');
  const collapsed = grid.classList.contains('team-sidebar-collapsed');
  localStorage.setItem('teamSidebarCollapsed', collapsed ? '1' : '0');
}

function _restoreTeamSidebarState() {
  const grid = document.querySelector('#teams-view-detail .grid');
  if (!grid) return;
  if (localStorage.getItem('teamSidebarCollapsed') === '1') {
    grid.classList.add('team-sidebar-collapsed');
  } else {
    grid.classList.remove('team-sidebar-collapsed');
  }
}

let _lastTeamDetailId = null;
let _teamDetailData = null;

async function showTeamDetailView(teamId) {
  _lastTeamDetailId = teamId;
  const listEl = document.getElementById('teams-view-list');
  const detailEl = document.getElementById('teams-view-detail');
  if (listEl) listEl.classList.add('hidden');
  if (detailEl) detailEl.classList.remove('hidden');
  _restoreTeamSidebarState();

  // Show loading in content pane
  const pane = document.getElementById('team-content-pane');
  if (pane) pane.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';
  const sidebarHeader = document.getElementById('team-sidebar-header');
  const sidebarTabs = document.getElementById('team-sidebar-tabs');
  if (sidebarHeader) sidebarHeader.innerHTML = '';
  if (sidebarTabs) sidebarTabs.innerHTML = '';

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

    // Mark team chat as read
    fetch(`/api/teams/${teamId}/chat-read`, { method: 'POST', headers: _authHeaders() }).then(() => refreshInboxBadge()).catch(() => {});

    // Merge: team experiments for this team + own experiments assigned to this team
    const seen = new Set();
    const teamExps = [];
    for (const e of allTeamExps) {
      if (e.team_id === teamId && !seen.has(e.id)) { seen.add(e.id); teamExps.push(e); }
    }
    for (const e of ownExps) {
      if (e.team_id === teamId && !seen.has(e.id)) { seen.add(e.id); teamExps.push(e); }
    }

    // Store data for tab switching
    const teamChildren = team.children || [];
    _teamDetailData = { teamId, team, teamExps, chatMessages, teamTodos, isOwner, teamChildren };

    // Populate sidebar header (matches exp-detail-title style)
    if (sidebarHeader) {
      const lockSvg = team.private ? ' <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;opacity:0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : '';
      const ancestorBreadcrumb = (team.ancestors && team.ancestors.length)
        ? `<div class="text-dimmest text-[0.65rem] mb-1">${team.ancestors.map(a => `<span class="cursor-pointer hover:text-accent" onclick="showTeamDetailView(${a.id})">${escapeHtml(a.name)}</span>`).join(' <span class="text-dimmer">›</span> ')} <span class="text-dimmer">›</span></div>`
        : '';
      sidebarHeader.innerHTML = `
        ${ancestorBreadcrumb}
        <div id="team-name-display" class="text-[1.1rem] font-semibold text-white_ mb-1 truncate${isOwner ? ' cursor-pointer hover:text-accent transition-colors' : ''}"${isOwner ? ' onclick="startRenameTeam()" title="Click to rename"' : ''}>${escapeHtml(team.name)}${lockSvg}</div>
        <div class="text-dimmer text-[0.72rem] mb-2 cursor-pointer hover:text-accent transition-colors" onclick="switchTeamTab('members')">${team.members.length} member${team.members.length !== 1 ? 's' : ''}</div>
        ${isOwner ? `<div class="flex items-center gap-2 mb-2">
          <label class="flex items-center gap-1.5 text-dimmer text-[0.7rem] cursor-pointer">
            <input type="checkbox" ${team.private ? 'checked' : ''} onchange="toggleTeamPrivacy(${teamId}, this.checked)" class="accent-[var(--accent)]"> Private
          </label>
        </div>` : ''}
      `;
    }

    // Populate sidebar tabs (styled like exp-file-row items)
    const openTodos = teamTodos.filter(t => !t.done);
    const tabs = [
      { key: 'experiments', badge: 'EXP', badgeCls: 'bg-purple-500/15 text-purple-400', label: 'Experiments', count: teamExps.length },
      { key: 'tasks', badge: 'TSK', badgeCls: 'bg-green-500/15 text-green-400', label: 'Tasks', count: openTodos.length },
      { key: 'members', badge: 'MBR', badgeCls: 'bg-blue-500/15 text-blue-400', label: 'Members', count: team.members.length },
      { key: 'chat', badge: 'MSG', badgeCls: 'bg-amber-500/15 text-amber-400', label: 'Chat', count: chatMessages.length },
    ];
    if (teamChildren.length) {
      tabs.push({ key: 'subteams', badge: 'SUB', badgeCls: 'bg-cyan-500/15 text-cyan-400', label: 'Sub-teams', count: teamChildren.length });
    }
    if (sidebarTabs) {
      sidebarTabs.innerHTML = `<div class="flex items-center justify-between mb-2 px-2"><span class="text-[0.75rem] text-dim uppercase tracking-wide">Sections</span></div>` + tabs.map(t => `
        <div id="team-tab-${t.key}" class="flex items-center py-1.5 px-2 rounded-md cursor-pointer hover:bg-card/50 group transition-colors"
             onclick="switchTeamTab('${t.key}')">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <span class="text-[0.7rem] px-1 py-0.5 rounded shrink-0 ${t.badgeCls}">${t.badge}</span>
            <span class="text-[0.8rem] text-primary truncate">${t.label}</span>
          </div>
          <span class="text-dimmest text-[0.65rem] shrink-0">${t.count}</span>
        </div>
      `).join('');
    }

    // Default to chat tab
    switchTeamTab('chat');
  } catch (err) {
    if (pane) pane.innerHTML = `<div class="text-center py-10 text-red-400 text-sm">Failed to load team</div>`;
  }
}

function startRenameTeam() {
  if (!_teamDetailData || !_teamDetailData.isOwner) return;
  const el = document.getElementById('team-name-display');
  if (!el) return;
  const currentName = _teamDetailData.team.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'text-[1.1rem] font-semibold text-white_ bg-transparent border-b-2 border-accent outline-none w-full';
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishRenameTeam(input); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRenameTeam(); }
  };
  input.onblur = () => finishRenameTeam(input);
  el.replaceWith(input);
  input.focus();
  input.select();
}

async function finishRenameTeam(input) {
  if (!_teamDetailData) return;
  const newName = input.value.trim();
  if (!newName || newName === _teamDetailData.team.name) {
    cancelRenameTeam();
    return;
  }
  try {
    const resp = await fetch(`/api/teams/${_teamDetailData.teamId}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (resp.ok) {
      _teamDetailData.team.name = newName;
    }
  } catch (e) { console.error('Rename team error', e); }
  cancelRenameTeam();
}

function cancelRenameTeam() {
  if (!_teamDetailData) return;
  const sidebarHeader = document.getElementById('team-sidebar-header');
  if (!sidebarHeader) return;
  const team = _teamDetailData.team;
  const isOwner = _teamDetailData.isOwner;
  const lockSvg = team.private ? ' <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;opacity:0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : '';
  const ancestorBreadcrumb = (team.ancestors && team.ancestors.length)
    ? `<div class="text-dimmest text-[0.65rem] mb-1">${team.ancestors.map(a => `<span class="cursor-pointer hover:text-accent" onclick="showTeamDetailView(${a.id})">${escapeHtml(a.name)}</span>`).join(' <span class="text-dimmer">›</span> ')} <span class="text-dimmer">›</span></div>`
    : '';
  sidebarHeader.innerHTML = `
    ${ancestorBreadcrumb}
    <div id="team-name-display" class="text-[1.1rem] font-semibold text-white_ mb-1 truncate${isOwner ? ' cursor-pointer hover:text-accent transition-colors' : ''}"${isOwner ? ' onclick="startRenameTeam()" title="Click to rename"' : ''}>${escapeHtml(team.name)}${lockSvg}</div>
    <div class="text-dimmer text-[0.72rem] mb-2 cursor-pointer hover:text-accent transition-colors" onclick="switchTeamTab('members')">${team.members.length} member${team.members.length !== 1 ? 's' : ''}</div>
    ${isOwner ? `<div class="flex items-center gap-2 mb-2">
      <label class="flex items-center gap-1.5 text-dimmer text-[0.7rem] cursor-pointer">
        <input type="checkbox" ${team.private ? 'checked' : ''} onchange="toggleTeamPrivacy(${_teamDetailData.teamId}, this.checked)" class="accent-[var(--accent)]"> Private
      </label>
    </div>` : ''}
  `;
}

function switchTeamTab(tab) {
  if (!_teamDetailData) return;
  const { teamId, team, teamExps, chatMessages, teamTodos, isOwner, teamChildren } = _teamDetailData;
  const pane = document.getElementById('team-content-pane');
  if (!pane) return;

  // Highlight active tab
  ['experiments', 'tasks', 'members', 'chat', 'subteams'].forEach(k => {
    const el = document.getElementById('team-tab-' + k);
    if (el) {
      if (k === tab) {
        el.classList.add('bg-card');
      } else {
        el.classList.remove('bg-card');
      }
    }
  });

  if (tab === 'experiments') {
    pane.innerHTML = teamExps.length ? `
      <div class="px-4 pt-4">
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
    ` : `<div class="px-4 pt-4 text-dimmer text-xs">No experiments shared with this team yet. Assign a team to an experiment from the experiment detail page.</div>`;

  } else if (tab === 'tasks') {
    const priorityColors = { high: '#f87171', medium: '#fbbf24', low: '#6ee7b7' };
    const priorityLabels = { high: 'High', medium: 'Med', low: 'Low' };
    const openTodos = teamTodos.filter(t => !t.done);
    const doneTodos = teamTodos.filter(t => t.done);
    const memberOpts = team.members.map(m => `<option value="${escapeAttr(m.google_id)}">${escapeHtml(m.username || 'unknown')}</option>`).join('');

    pane.innerHTML = `
      <div class="px-4 pt-4">
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

  } else if (tab === 'members') {
    pane.innerHTML = `
      <div class="px-4 pt-4">
        <div class="mb-6">
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
      </div>
    `;

  } else if (tab === 'chat') {
    pane.innerHTML = `
      <div class="flex flex-col h-full">
        <div id="team-chat-messages-${teamId}" class="flex-1 overflow-y-auto px-4 pt-4 flex flex-col gap-2">
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
                <div class="flex flex-wrap gap-1 mt-1" id="chat-reactions-${m.id}">${renderReactionsRow(teamId, m.id, m.reactions || [])}</div>
                ${ownActions}
              </div>
            </div>`;
          }).join('') : '<div class="text-dimmer text-xs text-center py-4">No messages yet. Start the conversation!</div>'}
        </div>
        <div class="flex gap-2 items-center px-4 py-3 border-t border-border-card" style="position:relative">
          <input type="text" id="team-chat-input-${teamId}" placeholder="Type a message..." class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();sendTeamChatMessage(${teamId})}">
          <button onclick="toggleFileRefPicker(${teamId}, this)" class="bg-transparent border border-border-input text-muted text-sm px-2 py-1.5 rounded-md cursor-pointer hover:text-primary hover:border-accent transition-colors" title="Reference a file" style="line-height:1">📎</button>
          <button onclick="sendTeamChatMessage(${teamId})" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover transition-colors">Send</button>
        </div>
      </div>
    `;
    // Scroll chat to bottom
    setTimeout(() => {
      const chatEl = document.getElementById('team-chat-messages-' + teamId);
      if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    }, 50);

  } else if (tab === 'subteams') {
    const lockSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;opacity:0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    pane.innerHTML = (teamChildren || []).length ? `
      <div class="px-4 pt-4">
        <div class="flex flex-col gap-2">
          ${teamChildren.map(c => `
            <div class="flex items-center gap-3 p-3 rounded-lg border border-border-card bg-card hover:border-border-input transition-colors cursor-pointer" onclick="showTeamDetailView(${c.id})">
              <div class="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">${escapeHtml(c.name[0].toUpperCase())}</div>
              <div class="text-primary text-sm font-medium">${escapeHtml(c.name)}${c.private ? ' ' + lockSvg : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : `<div class="px-4 pt-4 text-dimmer text-xs">No sub-teams</div>`;
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
            <div class="flex flex-wrap gap-1 mt-1" id="chat-reactions-${msg.id}">${renderReactionsRow(teamId, msg.id, [])}</div>
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

async function toggleFileRefPicker(teamId, btn) {
  // Remove existing picker
  const existing = document.getElementById('file-ref-picker');
  if (existing) { existing.remove(); return; }

  const rect = btn.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.id = 'file-ref-picker';
  dd.style.cssText = `position:fixed;z-index:10001;background:var(--bg-card);border:1px solid var(--border-card);border-radius:8px;padding:8px;width:300px;max-height:350px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.3)`;
  dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  dd.style.left = rect.left + 'px';
  dd.innerHTML = '<div class="text-center py-4 text-dim text-xs"><div class="spinner"></div></div>';
  document.body.appendChild(dd);

  // Close on outside click
  const close = (e) => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);

  // Fetch team experiments
  try {
    const [expResp, ownResp] = await Promise.all([
      fetch('/api/team-experiments', { headers: _authHeaders() }),
      fetch('/api/experiments', { headers: _authHeaders() }),
    ]);
    const teamExps = (await expResp.json()).filter(e => e.team_id === teamId);
    const ownExps = (await ownResp.json()).filter(e => e.team_id === teamId);
    const seen = new Set();
    const exps = [];
    for (const e of [...teamExps, ...ownExps]) {
      if (!seen.has(e.id)) { seen.add(e.id); exps.push(e); }
    }
    if (!exps.length) {
      dd.innerHTML = '<div class="text-dimmer text-xs text-center py-4">No experiments in this team</div>';
      return;
    }
    dd.innerHTML = `<div class="text-[0.7rem] text-dim font-semibold uppercase tracking-wide mb-2">Pick experiment</div>` +
      exps.map(e => `<div class="px-2 py-1.5 rounded cursor-pointer hover:bg-accent/10 text-sm text-primary truncate" onclick="fileRefPickExp('${escapeAttr(e.id)}', ${teamId})">${escapeHtml(e.name || e.id)}</div>`).join('');
  } catch {
    dd.innerHTML = '<div class="text-red-400 text-xs text-center py-4">Failed to load</div>';
  }
}

async function fileRefPickExp(expId, teamId) {
  const dd = document.getElementById('file-ref-picker');
  if (!dd) return;
  dd.innerHTML = '<div class="text-center py-4 text-dim text-xs"><div class="spinner"></div></div>';
  try {
    const resp = await fetch(`/api/experiments/${encodeURIComponent(expId)}/files`, { headers: _authHeaders() });
    const data = await resp.json();
    const files = (data.files || []).filter(f => !f.endsWith('/'));
    if (!files.length) {
      dd.innerHTML = '<div class="text-dimmer text-xs text-center py-4">No files in this experiment</div>';
      return;
    }
    const extColors = { py: '#3572A5', js: '#f1e05a', ts: '#3178c6', md: '#083fa1', tex: '#3D6117', css: '#563d7c', html: '#e34c26', json: '#292929', ipynb: '#DA5B0B' };
    dd.innerHTML = `<div class="text-[0.7rem] text-dim font-semibold uppercase tracking-wide mb-2" style="display:flex;align-items:center;gap:6px">
        <span onclick="fileRefPickBack(${teamId})" class="cursor-pointer text-accent" style="font-size:0.8rem">←</span>
        Pick file
      </div>` +
      files.map(f => {
        const ext = f.split('.').pop().toLowerCase();
        const dot = extColors[ext] || 'var(--text-dimmest)';
        return `<div class="px-2 py-1.5 rounded cursor-pointer hover:bg-accent/10 text-sm text-primary truncate flex items-center gap-2" onclick="insertFileRef('${escapeAttr(expId)}', '${escapeAttr(f)}', ${teamId})">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0"></span>
          ${escapeHtml(f)}
        </div>`;
      }).join('');
  } catch {
    dd.innerHTML = '<div class="text-red-400 text-xs text-center py-4">Failed to load files</div>';
  }
}

function fileRefPickBack(teamId) {
  const dd = document.getElementById('file-ref-picker');
  if (dd) dd.remove();
  const btn = document.querySelector(`#team-chat-input-${teamId}`)?.parentElement?.querySelector('[title="Reference a file"]');
  if (btn) toggleFileRefPicker(teamId, btn);
}

function insertFileRef(expId, filePath, teamId) {
  const dd = document.getElementById('file-ref-picker');
  if (dd) dd.remove();
  const input = document.getElementById(`team-chat-input-${teamId}`);
  if (!input) return;
  const ref = `[file:${expId}/${filePath}]`;
  const pos = input.selectionStart || input.value.length;
  input.value = input.value.slice(0, pos) + ref + input.value.slice(pos);
  input.focus();
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

async function toggleTeamPrivacy(teamId, isPrivate) {
  try {
    await fetch(`/api/teams/${teamId}/privacy`, {
      method: 'PUT',
      headers: _authHeaders(),
      body: JSON.stringify({ private: isPrivate })
    });
    if (_teamDetailData && _teamDetailData.team) {
      _teamDetailData.team.private = isPrivate;
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
    const _lockSvgSm = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;opacity:0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    container.innerHTML = _cachedTeams.map(t => `
      <div class="flex items-center justify-between p-3 bg-card border border-border-card rounded-lg mb-2 group">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">${escapeHtml(t.name[0].toUpperCase())}</div>
          <div>
            <div class="text-primary text-sm font-medium">${escapeHtml(t.name)}${t.private ? ' ' + _lockSvgSm : ''}</div>
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

  // Clear form container — button is now in the heading
  const formEl = document.getElementById('create-team-form');
  if (formEl) formEl.innerHTML = '';
}

// createTeamFromForm is now handled by showCreateTeamPopup('settings') + submitCreateTeamPopup()

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
