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
  if (pathOnly === '/api/arxiv-search' && method === 'POST') {
    const result = await window.electronAPI.toolExecute('paper-search', body, { googleId });
    return _unwrapTool(result);
  }

  // ── Feed — via tools ──
  if (pathOnly === '/api/feed-items' && method === 'GET') {
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

  // ── Experiments — via tools ──
  if (pathOnly === '/api/experiments' && method === 'GET') {
    if (!googleId) return null;
    const result = await window.electronAPI.toolExecute('experiment-list', {}, { googleId });
    return _unwrapTool(result, 'projects') ?? [];
  }
  if (pathOnly === '/api/experiments' && method === 'POST') {
    if (!googleId) return null;
    const result = await window.electronAPI.toolExecute('experiment-create', body, { googleId });
    return _unwrapTool(result);
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

  // Not handled — return null to fall back to HTTP
  return null;
}

/** Get the current user's google_id from localStorage session */
function _getGoogleId() {
  try {
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      return user.google_id || user.googleId || null;
    }
  } catch (e) {}
  return null;
}
