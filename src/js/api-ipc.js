// api-ipc.js — IPC route bridge
// Maps Flask HTTP endpoint paths to Electron IPC calls.
// When the core TypeScript backend is available (window.electronAPI.coreAvailable),
// this intercepts API calls and routes them through IPC instead of HTTP.
// Falls back to null (meaning "use HTTP") for unhandled routes.

/** Unwrap a tool result {success, data, error} to match Flask response format */
function _unwrapTool(result, dataKey) {
  if (!result || !result.success) return null; // fall back to HTTP
  if (dataKey && result.data && result.data[dataKey] !== undefined) return result.data[dataKey];
  return result.data;
}

/**
 * Try to handle an API call via IPC. Returns a result object or null if unhandled.
 * @param {string} path - The API path (e.g., '/api/calendar')
 * @param {object} opts - fetch options { method, body, headers }
 * @returns {Promise<object|null>} Result data or null if this path isn't IPC-handled
 */
async function ipcRoute(path, opts = {}) {
  if (!window.electronAPI || !window.electronAPI.coreAvailable) return null;

  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const googleId = _getGoogleId();

  // Split path and query string for routes with query params
  const [pathOnly, queryStr] = path.split('?');

  // ── Calendar ──
  if (pathOnly === '/api/calendar' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('calendar-list', googleId);
  }
  if (pathOnly === '/api/calendar' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('calendar-create', googleId, body);
  }
  if (pathOnly.match(/^\/api\/calendar\/[^/]+$/) && method === 'PUT') {
    if (!googleId) return null;
    const eventId = pathOnly.split('/').pop();
    return await window.electronAPI.dbQuery('calendar-update', googleId, eventId, body);
  }
  if (pathOnly.match(/^\/api\/calendar\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const eventId = pathOnly.split('/').pop();
    const deleted = await window.electronAPI.dbQuery('calendar-delete', googleId, eventId);
    return { ok: deleted };
  }

  // ── Vault (notes) — via tools, unwrap to match Flask format ──
  if (pathOnly === '/api/vault/notes' && method === 'GET') {
    if (!googleId) return null;
    const result = await window.electronAPI.toolExecute('vault-list-notes', {}, { googleId });
    return _unwrapTool(result, 'notes') ?? [];
  }
  if (pathOnly === '/api/vault/notes' && method === 'POST') {
    if (!googleId) return null;
    const result = await window.electronAPI.toolExecute('vault-create-note', body, { googleId });
    return _unwrapTool(result);
  }
  if (pathOnly.match(/^\/api\/vault\/notes\/[^/]+$/) && method === 'GET') {
    if (!googleId) return null;
    const noteId = pathOnly.split('/').pop();
    const result = await window.electronAPI.toolExecute('vault-get-note', { id: noteId }, { googleId });
    return _unwrapTool(result);
  }
  if (pathOnly.match(/^\/api\/vault\/notes\/[^/]+$/) && method === 'PUT') {
    if (!googleId) return null;
    const noteId = pathOnly.split('/').pop();
    const result = await window.electronAPI.toolExecute('vault-update-note', { id: noteId, ...body }, { googleId });
    return _unwrapTool(result);
  }
  if (pathOnly.match(/^\/api\/vault\/notes\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const noteId = pathOnly.split('/').pop();
    const result = await window.electronAPI.toolExecute('vault-delete-note', { id: noteId }, { googleId });
    return _unwrapTool(result) ?? { ok: true };
  }

  // ── Search — via tools ──
  if (pathOnly === '/api/web-search' && method === 'POST') {
    const result = await window.electronAPI.toolExecute('web-search', body, { googleId });
    return _unwrapTool(result);
  }
  if (pathOnly === '/api/arxiv-search' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const data = await window.electronAPI.dbQuery('arxiv-search-xml',
      urlParams.get('q') || '', parseInt(urlParams.get('start') || '0'), parseInt(urlParams.get('max_results') || '100'));
    if (data.error) throw new Error(data.error);
    return data; // { xml: '...' }
  }
  if (pathOnly === '/api/arxiv-search' && method === 'POST') {
    const result = await window.electronAPI.toolExecute('paper-search', body, { googleId });
    return _unwrapTool(result);
  }

  // ── Feed — via tools ──
  if (pathOnly === '/api/feed-items' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const sources = (urlParams.get('sources') || '').split(',').filter(Boolean);
    const limit = parseInt(urlParams.get('limit') || '100');
    if (sources.length) {
      return await window.electronAPI.dbQuery('feed-items', sources, limit);
    }
    const result = await window.electronAPI.toolExecute('feed-list', {}, { googleId });
    return _unwrapTool(result, 'items') ?? [];
  }

  // ── Extract text — via tools ──
  if (pathOnly === '/api/extract-text' && method === 'POST') {
    const result = await window.electronAPI.toolExecute('extract-text', body, { googleId });
    return _unwrapTool(result);
  }

  // ── Users ──
  if (pathOnly === '/api/auth/me' && method === 'GET') {
    if (!googleId) return null; // fall back to Flask for full auth flow
    return await window.electronAPI.dbQuery('user-get', googleId);
  }
  if (pathOnly === '/api/users' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const q = urlParams.get('q');
    if (q) return await window.electronAPI.dbQuery('users-search', q);
    return await window.electronAPI.dbQuery('users-list');
  }

  // ── Teams ──
  if (pathOnly === '/api/teams' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('teams-list', googleId);
  }
  if (pathOnly.match(/^\/api\/teams\/\d+\/messages$/) && method === 'GET') {
    const teamId = parseInt(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('team-messages', teamId);
  }
  if (pathOnly.match(/^\/api\/teams\/\d+\/messages$/) && method === 'POST') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('team-message-send', teamId, googleId, body.content);
  }
  if (pathOnly.match(/^\/api\/teams\/\d+\/todos$/) && method === 'GET') {
    const teamId = parseInt(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('team-todos', teamId);
  }

  // ── Experiments ──
  if (pathOnly === '/api/experiments' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('exp-list', googleId);
  }
  if (pathOnly === '/api/experiments' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('exp-create', googleId, body.title);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+$/) && method === 'GET') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-get', googleId, expId);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-delete', googleId, expId);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/files$/) && method === 'GET') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-files', googleId, expId);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/files\//) && method === 'GET') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const expId = decodeURIComponent(parts[3]);
    const fname = decodeURIComponent(parts.slice(5).join('/'));
    return await window.electronAPI.dbQuery('exp-file-get', googleId, expId, fname);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/files$/) && method === 'POST') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-file-create', googleId, expId, body.name, body.content);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/files\//) && method === 'PUT') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const expId = decodeURIComponent(parts[3]);
    const fname = decodeURIComponent(parts.slice(5).join('/'));
    return await window.electronAPI.dbQuery('exp-file-update', googleId, expId, fname, body);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/files\//) && method === 'DELETE') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const expId = decodeURIComponent(parts[3]);
    const fname = decodeURIComponent(parts.slice(5).join('/'));
    return await window.electronAPI.dbQuery('exp-file-delete', googleId, expId, fname);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/raw\//) && method === 'GET') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const expId = decodeURIComponent(parts[3]);
    const fname = decodeURIComponent(parts.slice(5).join('/'));
    return await window.electronAPI.dbQuery('exp-raw-file', googleId, expId, fname);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/create-folder$/) && method === 'POST') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-create-folder', googleId, expId, body.name);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/delete-folder$/) && method === 'POST') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-delete-folder', googleId, expId, body.folder);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/rename-folder$/) && method === 'POST') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-rename-folder', googleId, expId, body.oldName, body.newName);
  }
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/move-file$/) && method === 'POST') {
    if (!googleId) return null;
    const expId = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('exp-move-file', googleId, expId, body.oldPath, body.newPath);
  }

  // ── Providers / Models ──
  if (pathOnly === '/api/models' && method === 'GET') {
    const models = await window.electronAPI.providerModels();
    return { models };
  }

  // ── Chat memory — via tools ──
  if (pathOnly === '/api/chat-memory' && method === 'POST') {
    if (!googleId) return null;
    const result = await window.electronAPI.toolExecute('memory-save-chat', body, { googleId });
    return _unwrapTool(result) ?? { ok: true };
  }
  if (pathOnly.startsWith('/api/chat-memories') && method === 'GET') {
    if (!googleId) return null;
    const urlParams = new URLSearchParams(queryStr || '');
    const query = urlParams.get('query');
    if (query) {
      const result = await window.electronAPI.toolExecute('memory-recall-chat', { query }, { googleId });
      return _unwrapTool(result);
    }
    const result = await window.electronAPI.toolExecute('memory-recall-chat', {}, { googleId });
    return _unwrapTool(result);
  }

  // ── TTS — via tools ──
  if (pathOnly === '/api/tts' && method === 'POST') {
    const result = await window.electronAPI.toolExecute('media-tts', body, { googleId });
    return _unwrapTool(result);
  }

  // ── Transcribe — via tools ──
  if (pathOnly === '/api/transcribe' && method === 'POST') {
    const result = await window.electronAPI.toolExecute('media-transcribe', body, { googleId });
    return _unwrapTool(result);
  }

  // ── Auth: logout ──
  if (pathOnly === '/api/auth/logout' && method === 'POST') {
    const token = _getAuthToken();
    if (token) await window.electronAPI.dbQuery('session-delete', token);
    return { ok: true };
  }

  // ── Auth: set username ──
  if (pathOnly === '/api/auth/username' && method === 'POST') {
    if (!googleId) return null;
    const ok = await window.electronAPI.dbQuery('user-set-username', googleId, body.username);
    if (ok) return { ok: true, username: body.username };
    return null; // fall back to Flask for error handling
  }

  // ── Auth: delete account ──
  if (pathOnly === '/api/auth/delete-account' && method === 'POST') {
    if (!googleId) return null;
    await window.electronAPI.dbQuery('user-delete', googleId);
    return { ok: true };
  }

  // ── Auth: sync ──
  if (pathOnly === '/api/sync' && method === 'POST') {
    if (!googleId) return null;
    const merged = await window.electronAPI.dbQuery('user-sync', googleId, body.data || {});
    return { data: merged };
  }

  // ── Teams: create ──
  if (pathOnly === '/api/teams' && method === 'POST') {
    if (!googleId) return null;
    const teamId = await window.electronAPI.dbQuery('team-create', body.name, googleId, { private: body.private, parentId: body.parent_id });
    return { ok: true, id: teamId };
  }

  // ── Teams: detail (GET /api/teams/<id>) ──
  if (pathOnly.match(/^\/api\/teams\/\d+$/) && method === 'GET') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/').pop());
    return await window.electronAPI.dbQuery('team-detail', teamId);
  }

  // ── Teams: rename (PUT /api/teams/<id>) ──
  if (pathOnly.match(/^\/api\/teams\/\d+$/) && method === 'PUT') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/').pop());
    const ok = await window.electronAPI.dbQuery('team-rename', teamId, body.name, googleId);
    return ok ? { ok: true } : null;
  }

  // ── Teams: delete (DELETE /api/teams/<id>) ──
  if (pathOnly.match(/^\/api\/teams\/\d+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/').pop());
    return await window.electronAPI.dbQuery('team-delete', teamId, googleId);
  }

  // ── Teams: invite ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/invite$/) && method === 'POST') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('team-invite', teamId, googleId, body.username);
  }

  // ── Teams: remove member ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/remove$/) && method === 'POST') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    const ok = await window.electronAPI.dbQuery('team-remove-member', teamId, googleId, body.google_id);
    return ok ? { ok: true } : null;
  }

  // ── Teams: privacy ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/privacy$/) && method === 'PUT') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    const ok = await window.electronAPI.dbQuery('team-set-private', teamId, !!body.private, googleId);
    return ok ? { ok: true, private: !!body.private } : null;
  }

  // ── Teams: parent ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/parent$/) && method === 'PUT') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    const ok = await window.electronAPI.dbQuery('team-set-parent', teamId, body.parent_id ?? null, googleId);
    return ok ? { ok: true } : null;
  }

  // ── Teams: chat read ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/chat-read$/) && method === 'POST') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    await window.electronAPI.dbQuery('team-chat-mark-read', teamId, googleId);
    return { ok: true };
  }

  // ── Teams: edit message (PUT) ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/messages\/[^/]+$/) && method === 'PUT') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const teamId = parseInt(parts[3]);
    const msgId = parts[5];
    const ok = await window.electronAPI.dbQuery('team-message-edit', teamId, msgId, googleId, body.content);
    return ok ? { ok: true } : null;
  }

  // ── Teams: delete message ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/messages\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const teamId = parseInt(parts[3]);
    const msgId = parts[5];
    const ok = await window.electronAPI.dbQuery('team-message-delete', msgId, googleId);
    return ok ? { ok: true } : null;
  }

  // ── Teams: reactions ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/messages\/[^/]+\/reactions$/) && method === 'POST') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const msgId = parts[5];
    return await window.electronAPI.dbQuery('reaction-toggle', msgId, googleId, body.emoji);
  }

  // ── Teams: todos — create ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/todos$/) && method === 'POST') {
    if (!googleId) return null;
    const teamId = parseInt(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('team-todo-create', teamId, googleId, body);
  }

  // ── Teams: todos — update (PUT) ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/todos\/[^/]+$/) && method === 'PUT') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const teamId = parseInt(parts[3]);
    const todoId = parts[5];
    return await window.electronAPI.dbQuery('team-todo-update', teamId, todoId, body);
  }

  // ── Teams: todos — delete ──
  if (pathOnly.match(/^\/api\/teams\/\d+\/todos\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    const teamId = parseInt(parts[3]);
    const todoId = parts[5];
    const ok = await window.electronAPI.dbQuery('team-todo-delete', teamId, todoId);
    return ok ? { ok: true } : null;
  }

  // ── Inbox ──
  if (pathOnly === '/api/inbox' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('pending-invites', googleId);
  }

  // ── Inbox: respond ──
  if (pathOnly.match(/^\/api\/inbox\/\d+\/respond$/) && method === 'POST') {
    if (!googleId) return null;
    const inviteId = parseInt(pathOnly.split('/')[3]);
    const ok = await window.electronAPI.dbQuery('invite-respond', inviteId, googleId, body.accept);
    return ok ? { ok: true } : null;
  }

  // ── Inbox chats ──
  if (pathOnly === '/api/inbox-chats' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('unread-team-chats', googleId);
  }

  // ── My tasks ──
  if (pathOnly === '/api/my-tasks' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('my-tasks', googleId);
  }

  // ── Messages: list ──
  if (pathOnly === '/api/messages' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('direct-messages', googleId);
  }

  // ── Messages: send ──
  if (pathOnly === '/api/messages' && method === 'POST') {
    if (!googleId) return null;
    // Need to resolve username to google_id
    const toUser = await window.electronAPI.dbQuery('user-by-username', body.to_username);
    if (!toUser) return null; // fall back
    return await window.electronAPI.dbQuery('direct-message-send', googleId, toUser.google_id, body.content);
  }

  // ── Messages: mark read ──
  if (pathOnly.match(/^\/api\/messages\/[^/]+\/read$/) && method === 'POST') {
    if (!googleId) return null;
    const msgId = pathOnly.split('/')[3];
    await window.electronAPI.dbQuery('dm-mark-read', googleId, msgId);
    return { ok: true };
  }

  // ── Messages: delete ──
  if (pathOnly.match(/^\/api\/messages\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const msgId = pathOnly.split('/').pop();
    const ok = await window.electronAPI.dbQuery('dm-delete', googleId, msgId);
    return ok ? { ok: true } : null;
  }

  // ── Messages: unread count ──
  if (pathOnly === '/api/messages/unread-count' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('unread-counts', googleId);
  }

  // ── Comments ──
  if (pathOnly === '/api/comments' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const paperLink = urlParams.get('paperLink');
    return await window.electronAPI.dbQuery('comments-get', paperLink || undefined);
  }
  if (pathOnly === '/api/comments' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('comment-create', googleId, body);
  }
  if (pathOnly.match(/^\/api\/comments\/[^/]+$/) && method === 'DELETE') {
    if (!googleId) return null;
    const commentId = pathOnly.split('/').pop();
    const ok = await window.electronAPI.dbQuery('comment-delete', googleId, commentId);
    return ok ? { ok: true } : null;
  }

  // ── Reposts ──
  if (pathOnly === '/api/reposts' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('repost-create', googleId, body.username, body.paperLink, body.paperTitle);
  }
  if (pathOnly === '/api/reposts' && method === 'DELETE') {
    if (!googleId) return null;
    await window.electronAPI.dbQuery('repost-delete', googleId, body.paperLink);
    return { ok: true };
  }

  // ── Achievements ──
  if (pathOnly === '/api/achievements' && method === 'GET') {
    if (!googleId) return null;
    const achievements = await window.electronAPI.dbQuery('achievements', googleId);
    return { achievements };
  }
  if (pathOnly === '/api/achievements/grant' && method === 'POST') {
    if (!googleId) return null;
    const ach = await window.electronAPI.dbQuery('achievement-grant', googleId, body.achievement_id);
    return { achievement: ach };
  }
  if (pathOnly.match(/^\/api\/achievements\/[^/]+$/) && method === 'GET') {
    const username = pathOnly.split('/').pop();
    const userInfo = await window.electronAPI.dbQuery('public-user-info', username);
    if (!userInfo) return null;
    const achievements = await window.electronAPI.dbQuery('achievements', userInfo.google_id);
    return { achievements };
  }

  // ── User profiles ──
  if (pathOnly.match(/^\/api\/users\/[^/]+$/) && method === 'GET') {
    if (!googleId) return null;
    const username = decodeURIComponent(pathOnly.split('/').pop());
    const info = await window.electronAPI.dbQuery('public-user-info', username);
    if (!info) return null; // fall back for 404
    if (info.profile_private && info.google_id !== googleId) {
      const teammates = await window.electronAPI.dbQuery('are-teammates', googleId, info.google_id);
      if (!teammates) return { username: info.username, picture: info.picture, profile_private: true };
    }
    const stats = await window.electronAPI.dbQuery('user-public-stats', info.google_id);
    const accentColor = await window.electronAPI.dbQuery('user-accent-color', info.google_id);
    const result = { ...info, ...stats, accent_color: accentColor };
    delete result.google_id;
    return result;
  }

  // ── User feeds ──
  if (pathOnly.match(/^\/api\/users\/[^/]+\/feeds$/) && method === 'GET') {
    if (!googleId) return null;
    const username = decodeURIComponent(pathOnly.split('/')[3]);
    const info = await window.electronAPI.dbQuery('public-user-info', username);
    if (!info) return null;
    if (info.profile_private && info.google_id !== googleId) {
      const teammates = await window.electronAPI.dbQuery('are-teammates', googleId, info.google_id);
      if (!teammates) return { catalogFeeds: [], customFeeds: [] };
    }
    const data = await window.electronAPI.dbQuery('user-feed-sources', info.google_id);
    const catalogKeys = Object.entries(data.feedSources || {}).filter(([, v]) => v).map(([k]) => k);
    const custom = (data.customFeeds || []).filter(f => f.enabled).map(f => ({ name: f.name || f.url || '', url: f.url || '' }));
    return { catalogFeeds: catalogKeys, customFeeds: custom };
  }

  // ── User comments ──
  if (pathOnly.match(/^\/api\/users\/[^/]+\/comments$/) && method === 'GET') {
    if (!googleId) return null;
    const username = decodeURIComponent(pathOnly.split('/')[3]);
    const info = await window.electronAPI.dbQuery('public-user-info', username);
    if (!info) return null;
    if (info.profile_private && info.google_id !== googleId) {
      const teammates = await window.electronAPI.dbQuery('are-teammates', googleId, info.google_id);
      if (!teammates) return [];
    }
    return await window.electronAPI.dbQuery('user-recent-comments', info.google_id);
  }

  // ── User reposts ──
  if (pathOnly.match(/^\/api\/users\/[^/]+\/reposts$/) && method === 'GET') {
    if (!googleId) return null;
    const username = decodeURIComponent(pathOnly.split('/')[3]);
    const info = await window.electronAPI.dbQuery('public-user-info', username);
    if (!info) return null;
    if (info.profile_private && info.google_id !== googleId) {
      const teammates = await window.electronAPI.dbQuery('are-teammates', googleId, info.google_id);
      if (!teammates) return [];
    }
    return await window.electronAPI.dbQuery('user-reposts', info.google_id);
  }

  // ── User teams ──
  if (pathOnly.match(/^\/api\/users\/[^/]+\/teams$/) && method === 'GET') {
    if (!googleId) return null;
    const username = decodeURIComponent(pathOnly.split('/')[3]);
    const info = await window.electronAPI.dbQuery('public-user-info', username);
    if (!info) return null;
    return await window.electronAPI.dbQuery('user-public-teams', info.google_id, googleId);
  }

  // ── User experiments (stub) ──
  if (pathOnly.match(/^\/api\/users\/[^/]+\/experiments$/) && method === 'GET') {
    return [];
  }

  // ── Team experiments (stub) ──
  if (pathOnly === '/api/team-experiments' && method === 'GET') {
    return [];
  }

  // ── Annotation feedback ──
  if (pathOnly === '/api/annotation-feedback' && method === 'POST') {
    await window.electronAPI.dbQuery('ann-feedback-create', {
      url: body.url, pageTitle: body.pageTitle, quote: body.quote,
      explanation: body.explanation, annType: body.annType, rating: body.rating
    });
    return { ok: true };
  }
  if (pathOnly === '/api/annotation-feedback' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const items = await window.electronAPI.dbQuery('ann-feedback-list',
      urlParams.get('rating') || undefined,
      parseInt(urlParams.get('limit') || '100'),
      parseInt(urlParams.get('offset') || '0')
    );
    return { items };
  }
  if (pathOnly === '/api/annotation-feedback/stats' && method === 'GET') {
    return await window.electronAPI.dbQuery('ann-feedback-stats');
  }
  if (pathOnly.match(/^\/api\/annotation-feedback\/\d+$/) && method === 'PUT') {
    const fid = parseInt(pathOnly.split('/').pop());
    await window.electronAPI.dbQuery('ann-feedback-update', fid, body.rating);
    return { ok: true };
  }
  if (pathOnly.match(/^\/api\/annotation-feedback\/\d+$/) && method === 'DELETE') {
    const fid = parseInt(pathOnly.split('/').pop());
    await window.electronAPI.dbQuery('ann-feedback-delete', fid);
    return { ok: true };
  }

  // ── Annotation categories ──
  if (pathOnly === '/api/annotation-categories' && method === 'GET') {
    const categories = await window.electronAPI.dbQuery('ann-categories-list');
    return { categories };
  }
  if (pathOnly === '/api/annotation-categories' && method === 'POST') {
    await window.electronAPI.dbQuery('ann-category-add', body.key, body.name, body.description, body.color);
    return { ok: true };
  }
  if (pathOnly.match(/^\/api\/annotation-categories\/[^/]+$/) && method === 'DELETE') {
    const key = pathOnly.split('/').pop();
    await window.electronAPI.dbQuery('ann-category-delete', key);
    return { ok: true };
  }

  // ── Chat memory list/delete/stats ──
  if (pathOnly === '/api/chat-memories/list' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('chat-memories-list',
      parseInt(urlParams.get('limit') || '50'),
      parseInt(urlParams.get('offset') || '0')
    );
  }
  if (pathOnly.match(/^\/api\/chat-memories\/\d+$/) && method === 'DELETE') {
    const memId = parseInt(pathOnly.split('/').pop());
    await window.electronAPI.dbQuery('chat-memory-delete', memId);
    return { ok: true };
  }
  if (pathOnly === '/api/chat-memories/stats' && method === 'GET') {
    return await window.electronAPI.dbQuery('chat-memory-stats');
  }

  // ── Blog votes ──
  if (pathOnly.match(/^\/api\/blog\/[^/]+\/[^/]+\/vote$/) && method === 'POST') {
    if (!googleId) return null;
    const parts = pathOnly.split('/');
    return await window.electronAPI.dbQuery('blog-vote', parts[3], parts[4], googleId, body.vote);
  }

  // ── Feed: blocked titles ──
  if (pathOnly === '/api/blocked-titles' && method === 'GET') {
    return await window.electronAPI.dbQuery('blocked-titles-get');
  }
  if (pathOnly === '/api/blocked-titles' && method === 'POST') {
    const titles = await window.electronAPI.dbQuery('blocked-titles-get');
    if (!titles.includes(body.title)) {
      titles.push(body.title);
      await window.electronAPI.dbQuery('blocked-titles-set', titles);
    }
    return { ok: true };
  }
  if (pathOnly === '/api/blocked-titles' && method === 'DELETE') {
    await window.electronAPI.dbQuery('blocked-titles-set', []);
    return { ok: true };
  }

  // ── Feed: quality prompt ──
  if (pathOnly === '/api/quality-prompt' && method === 'GET') {
    const prompt = await window.electronAPI.dbQuery('quality-prompt-get');
    return { prompt, default: null }; // default prompts are client-side constants
  }
  if (pathOnly === '/api/quality-prompt' && method === 'PUT') {
    await window.electronAPI.dbQuery('quality-prompt-set', body.prompt || null);
    const prompt = await window.electronAPI.dbQuery('quality-prompt-get');
    return { ok: true, prompt };
  }

  // ── User profile updates ──
  if (pathOnly === '/api/users/me/privacy' && method === 'PUT') {
    if (!googleId) return null;
    await window.electronAPI.dbQuery('user-set-privacy', googleId, !!body.profile_private);
    return { ok: true, profile_private: !!body.profile_private };
  }
  if (pathOnly === '/api/users/me/status' && method === 'PUT') {
    if (!googleId) return null;
    const emoji = (body.emoji || '').trim();
    const text = (body.text || '').trim().slice(0, 80);
    await window.electronAPI.dbQuery('user-set-status', googleId, emoji, text);
    const resp = { ok: true, status_emoji: emoji || null, status_text: text || null };
    if (emoji || text) {
      const ach = await window.electronAPI.dbQuery('achievement-grant', googleId, 'first_status');
      if (ach) resp.achievement = ach;
    }
    return resp;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 1: External HTTP calls
  // ═══════════════════════════════════════════════════════════════════

  // ── Auth: Google login ──
  if (pathOnly === '/api/auth/google' && method === 'POST') {
    return await window.electronAPI.dbQuery('auth-google', body.credential);
  }

  // ── Semantic Scholar ──
  if (pathOnly === '/api/author-details' && method === 'POST') {
    return await window.electronAPI.dbQuery('author-details', body.authorId);
  }
  if (pathOnly === '/api/citation-lookup' && method === 'POST') {
    return await window.electronAPI.dbQuery('citation-lookup', body.query);
  }
  if (pathOnly === '/api/paper-references' && method === 'POST') {
    return await window.electronAPI.dbQuery('paper-references', body.arxivId, body.refNum);
  }
  if (pathOnly === '/api/author-lookup' && method === 'POST') {
    return await window.electronAPI.dbQuery('author-lookup', body.query);
  }
  if (pathOnly === '/api/citations' && method === 'POST') {
    return await window.electronAPI.dbQuery('citations-batch', body.ids);
  }

  // ── Browse utilities ──
  if (pathOnly === '/api/check-embed' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('check-embed', urlParams.get('url') || '');
  }
  if (pathOnly === '/api/link-preview' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('link-preview', urlParams.get('url') || '');
  }
  if (pathOnly === '/api/stock-quote' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('stock-quote', urlParams.get('symbol') || '');
  }
  if (pathOnly === '/api/extract-links' && method === 'POST') {
    return await window.electronAPI.dbQuery('extract-links', body.url);
  }

  // ── Feed proxies ──
  if (pathOnly === '/feed' && method === 'GET') {
    const result = await window.electronAPI.dbQuery('feed-arxiv');
    if (result && result._proxy) return { _proxy: true, data: result.data, mime: result.mime };
    return result;
  }
  if (pathOnly === '/hn-feed' && method === 'GET') {
    return await window.electronAPI.dbQuery('feed-hn');
  }
  if (pathOnly === '/polymarket-feed' && method === 'GET') {
    return await window.electronAPI.dbQuery('feed-polymarket');
  }
  if (pathOnly === '/api/rss-proxy' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const result = await window.electronAPI.dbQuery('rss-proxy', urlParams.get('url') || '');
    if (result && result._proxy) return { _proxy: true, data: result.data, mime: result.mime };
    return result;
  }
  if (pathOnly === '/api/feed-items/custom' && method === 'POST') {
    return await window.electronAPI.dbQuery('feed-items-custom', body.feeds || []);
  }

  // ── File proxies ──
  if (pathOnly === '/api/image-proxy' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const result = await window.electronAPI.dbQuery('image-proxy', urlParams.get('url') || '');
    if (result && result._proxy) return { _proxy: true, data: result.data, mime: result.mime };
    return result;
  }
  if (pathOnly === '/api/arxiv-pdf' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const result = await window.electronAPI.dbQuery('arxiv-pdf', urlParams.get('id') || '');
    if (result && result._proxy) return { _proxy: true, data: result.data, mime: result.mime };
    return result;
  }
  if (pathOnly === '/api/pdf-proxy' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const result = await window.electronAPI.dbQuery('pdf-proxy', urlParams.get('url') || '');
    if (result && result._proxy) return { _proxy: true, data: result.data, mime: result.mime };
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 2: Simple Ollama calls
  // ═══════════════════════════════════════════════════════════════════

  if (pathOnly === '/api/panel-suggest' && method === 'POST') {
    return await window.electronAPI.dbQuery('panel-suggest', body.text || '');
  }
  if (pathOnly === '/api/search-suggest' && method === 'POST') {
    return await window.electronAPI.dbQuery('search-suggest', body.query || '');
  }
  if (pathOnly === '/api/quality-filter' && method === 'POST') {
    return await window.electronAPI.dbQuery('quality-filter', body);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 3: Embedding + Vector Search
  // ═══════════════════════════════════════════════════════════════════

  if (pathOnly === '/api/embed-content' && method === 'POST') {
    return await window.electronAPI.dbQuery('embed-content', body);
  }
  if (pathOnly === '/api/semantic-search' && method === 'POST') {
    return await window.electronAPI.dbQuery('semantic-search', body);
  }
  if (pathOnly === '/api/find-similar' && method === 'POST') {
    return await window.electronAPI.dbQuery('find-similar', body);
  }
  if (pathOnly === '/api/reading-connections' && method === 'POST') {
    return await window.electronAPI.dbQuery('reading-connections', body);
  }
  if (pathOnly === '/api/knowledge-graph/similarities' && method === 'POST') {
    return await window.electronAPI.dbQuery('knowledge-graph-sims', body);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 4: Complex Ollama / Streaming
  // ═══════════════════════════════════════════════════════════════════

  if (pathOnly === '/api/annotate' && method === 'POST') {
    return await window.electronAPI.dbQuery('annotate', body);
  }
  if (pathOnly === '/api/annotation-prompt' && method === 'GET') {
    return await window.electronAPI.dbQuery('annotation-prompt-get');
  }
  if (pathOnly === '/api/annotation-prompt' && method === 'PUT') {
    return await window.electronAPI.dbQuery('annotation-prompt-set', (body.prompt || '').trim() || null);
  }
  if (pathOnly === '/api/doc-chat' && method === 'POST') {
    // Streaming: return a marker; caller subscribes to IPC events
    const sessionId = 'dc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await window.electronAPI.dbQuery('doc-chat-start', {
      sessionId,
      context: body.context || '',
      messages: body.messages || [],
      vision: body.vision || false,
      model: body.model || '',
      tools: body.tools || false,
      think: body.think !== false,
      pageUrl: body.pageUrl || '',
      pageTitle: body.pageTitle || '',
    });
    return { _stream: true, sessionId };
  }
  if (pathOnly === '/api/vault-chat' && method === 'POST') {
    if (!googleId) return null;
    const sessionId = 'vc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await window.electronAPI.dbQuery('vault-chat-start', {
      sessionId,
      googleId,
      messages: body.messages || [],
      query: body.query || '',
      min_similarity: body.min_similarity || 0.7,
    });
    return { _stream: true, sessionId };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 5: Filesystem + Config
  // ═══════════════════════════════════════════════════════════════════

  if (pathOnly === '/api/client-config' && method === 'GET') {
    return await window.electronAPI.dbQuery('client-config');
  }
  if (pathOnly === '/api/version' && method === 'GET') {
    return await window.electronAPI.dbQuery('version');
  }
  if (pathOnly === '/api/saved-content' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('saved-content-get', urlParams.get('url') || '');
  }
  if (pathOnly === '/api/saved-content' && method === 'POST') {
    return await window.electronAPI.dbQuery('saved-content-set', body.url, body);
  }
  if (pathOnly.match(/^\/api\/blog\/[^/]+$/) && method === 'GET') {
    const username = decodeURIComponent(pathOnly.split('/')[3]);
    return await window.electronAPI.dbQuery('blog-list', username);
  }
  if (pathOnly.match(/^\/api\/blog\/[^/]+\/[^/]+$/) && method === 'GET') {
    const parts = pathOnly.split('/');
    const username = decodeURIComponent(parts[3]);
    const slug = decodeURIComponent(parts[4]);
    return await window.electronAPI.dbQuery('blog-get', username, slug, googleId);
  }

  // ── Reveal in Finder (IPC) ──
  if (pathOnly === '/api/reveal-in-finder' && method === 'POST') {
    await window.electronAPI.dbQuery('reveal-in-finder', body.filename || body.path || '');
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Flask-only routes — explicit proxy (no silent fallback)
  // These routes require the Python backend (PyTorch, Jupyter, venv,
  // Marimo, dev tooling) and are proxied directly to Flask.
  // ═══════════════════════════════════════════════════════════════════

  if (_isFlaskRoute(pathOnly)) {
    return _flaskProxy(path, opts);
  }

  // Unknown route — log and return null (should not happen in normal usage)
  console.warn('[api-ipc] Unhandled route:', method, path);
  return null;
}

/**
 * Check if a route must be handled by Flask (Python backend).
 * These are routes that require PyTorch, Jupyter kernels, venvs,
 * Marimo notebooks, dev introspection, or other Python-only features.
 */
function _isFlaskRoute(pathOnly) {
  // Neuralook (PyTorch/GPU)
  if (pathOnly.startsWith('/api/neuralook/')) return true;
  // Experiment: venv, kernel, execute, clone-repo, upload, compile-tex
  if (pathOnly === '/api/venvs') return true;
  if (pathOnly.match(/^\/api\/experiments\/[^/]+\/(venv|venv-info|packages|kernel|execute|clone-repo|upload|compile-tex)/) ) return true;
  // Vault: marimo, path, tree
  if (pathOnly.startsWith('/api/vault/marimo/')) return true;
  if (pathOnly === '/api/vault/path') return true;
  if (pathOnly === '/api/vault/tree') return true;
  // Dev tooling
  if (pathOnly === '/api/dev-stats') return true;
  if (pathOnly === '/api/dev-git-log') return true;
  if (pathOnly === '/api/dependency-graph') return true;
  if (pathOnly === '/api/function-registry') return true;
  if (pathOnly === '/api/validate-feeds') return true;
  if (pathOnly === '/api/validate-load-order') return true;
  if (pathOnly === '/api/settings') return true;
  if (pathOnly === '/tex-preview') return true;
  // Vibe git UI
  if (pathOnly.startsWith('/api/vibe/')) return true;
  // Static files served by Flask
  if (pathOnly === '/spinners.json') return true;
  // Custom feeds POST (uses feed_poller on Python side)
  if (pathOnly === '/api/custom-feeds' && true) return true;
  // Saved posts
  if (pathOnly === '/api/saved-posts') return true;
  // Local file serving
  if (pathOnly === '/api/local-file') return true;
  // Images API (dev.py disk storage)
  if (pathOnly === '/api/images') return true;
  // Blog unpublish
  if (pathOnly.match(/^\/api\/blog\/[^/]+\/[^/]+\/unpublish$/)) return true;

  return false;
}

/**
 * Proxy a request directly to Flask (Python backend).
 * Used for routes that require Python-only features.
 */
async function _flaskProxy(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const fetchOpts = {
    method,
    headers: _authHeaders(),
  };
  if (opts.body && method !== 'GET' && method !== 'HEAD') {
    fetchOpts.body = opts.body;
  }
  const resp = await fetch(path, fetchOpts);
  if (resp.status === 401) {
    _showLoginGate();
    throw new Error('Unauthorized');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return await resp.json();
  }
  // Non-JSON responses (XML, blobs, etc.)
  return await resp.text();
}

/** Get the auth token from localStorage */
function _getAuthToken() {
  try {
    return localStorage.getItem('token') || null;
  } catch (e) {}
  return null;
}

/** Get the current user's google_id from localStorage session */
function _getGoogleId() {
  try {
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      if (user.google_id || user.googleId) return user.google_id || user.googleId;
    }
    // Fallback: check authUserInfo (set during login before 'user' key exists)
    const authInfo = localStorage.getItem('authUserInfo');
    if (authInfo) {
      const info = JSON.parse(authInfo);
      if (info.google_id) return info.google_id;
    }
  } catch (e) {}
  return null;
}
