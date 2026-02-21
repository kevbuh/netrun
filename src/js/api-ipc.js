// api-ipc.js — IPC route bridge
// Maps API endpoint paths to Electron IPC calls.
// All routes are handled via IPC through the core TypeScript backend.

import Settings from '/js/core/core-settings.js';
import { logger } from '/js/logger.js';

/** Unwrap a tool result {success, data, error} */
export function _unwrapTool(result, dataKey) {
  if (!result || !result.success) return { error: result?.error || 'Tool call failed' };
  if (dataKey && result.data && result.data[dataKey] !== undefined) return result.data[dataKey];
  return result.data;
}

/**
 * Try to handle an API call via IPC. Returns a result object or null if unhandled.
 * @param {string} path - The API path (e.g., '/api/calendar')
 * @param {object} opts - fetch options { method, body, headers }
 * @returns {Promise<object|null>} Result data or null if this path isn't IPC-handled
 */
export async function ipcRoute(path, opts = {}) {
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
    if (!googleId) return { error: 'Not authenticated' };
    return await window.electronAPI.dbQuery('user-get', googleId);
  }
  if (pathOnly === '/api/users' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const q = urlParams.get('q');
    if (q) return await window.electronAPI.dbQuery('users-search', q);
    return await window.electronAPI.dbQuery('users-list');
  }

  // ── Providers / Models ──
  if (pathOnly === '/api/models' && method === 'GET') {
    const models = await window.electronAPI.providerModels();
    return { models };
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
    return { error: 'Username update failed' };
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
    if (!toUser) return { error: 'User not found' };
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
    return ok ? { ok: true } : { error: 'Delete failed' };
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
    return ok ? { ok: true } : { error: 'Delete failed' };
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
    if (!info) return { error: 'User not found' };
    if (info.profile_private && info.google_id !== googleId) {
      return { username: info.username, picture: info.picture, profile_private: true };
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
      return { catalogFeeds: [], customFeeds: [] };
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
    if (info.profile_private && info.google_id !== googleId) return [];
    return await window.electronAPI.dbQuery('user-recent-comments', info.google_id);
  }

  // ── User reposts ──
  if (pathOnly.match(/^\/api\/users\/[^/]+\/reposts$/) && method === 'GET') {
    if (!googleId) return null;
    const username = decodeURIComponent(pathOnly.split('/')[3]);
    const info = await window.electronAPI.dbQuery('public-user-info', username);
    if (!info) return null;
    if (info.profile_private && info.google_id !== googleId) return [];
    return await window.electronAPI.dbQuery('user-reposts', info.google_id);
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
  if (pathOnly === '/api/feed-items/catalog' && method === 'POST') {
    return await window.electronAPI.dbQuery('feed-items-catalog', body.entries || [], body.limit || 500);
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
  // ═══════════════════════════════════════════════════════════════════
  // Phase 4: Complex Ollama / Streaming
  // ═══════════════════════════════════════════════════════════════════

  // /api/annotate removed — insight pipeline handles this via IPC directly
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
  // ── Reveal in Finder (IPC) ──
  if (pathOnly === '/api/reveal-in-finder' && method === 'POST') {
    await window.electronAPI.dbQuery('reveal-in-finder', body.filename || body.path || '');
    return { ok: true };
  }

  // ── Social uploads ──
  if (pathOnly === '/api/users/me/picture' && method === 'PUT') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('upload-profile-picture', googleId, body.image);
  }
  if (pathOnly === '/api/users/me/background' && method === 'PUT') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('upload-profile-background', googleId, body.image);
  }

  // ── Dev simple routes ──
  if (pathOnly === '/api/settings' && method === 'GET') {
    return await window.electronAPI.dbQuery('settings');
  }
  if (pathOnly === '/api/images' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('upload-image', body.image);
  }
  if (pathOnly.match(/^\/api\/images\/[^/]+$/) && method === 'GET') {
    const filename = pathOnly.split('/').pop();
    return await window.electronAPI.dbQuery('serve-image', filename);
  }
  if (pathOnly === '/api/saved-posts' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('saved-posts', googleId, body);
  }
  if (pathOnly === '/api/custom-feeds' && method === 'POST') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('custom-feeds', googleId, body);
  }
  if (pathOnly === '/api/local-file' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const filePath = decodeURIComponent(urlParams.get('path') || '');
    return await window.electronAPI.dbQuery('local-file', filePath);
  }

  // ── Browse proxy ──
  if (pathOnly === '/api/browse-proxy' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('browse-proxy', urlParams.get('url') || '');
  }

  // ── TeX preview ──
  if (pathOnly === '/tex-preview' && method === 'GET') {
    return await window.electronAPI.dbQuery('tex-preview');
  }

  // ── Dev git/stats ──
  if (pathOnly === '/api/dev-git-log' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    const offset = parseInt(urlParams.get('offset') || '0');
    const limit = parseInt(urlParams.get('limit') || '20');
    return await window.electronAPI.dbQuery('dev-git-log', offset, limit);
  }
  if (pathOnly === '/api/dev-stats' && method === 'GET') {
    return await window.electronAPI.dbQuery('dev-stats');
  }
  if (pathOnly === '/api/function-registry' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('function-registry');
  }
  if (pathOnly === '/api/validate-feeds' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('validate-feeds');
  }
  if (pathOnly === '/api/validate-load-order' && method === 'GET') {
    if (!googleId) return null;
    return await window.electronAPI.dbQuery('validate-load-order');
  }
  if ((pathOnly === '/api/dependency-graph' && method === 'GET') || (pathOnly === '/api/dependency-graph' && method === 'POST')) {
    if (!googleId) return null;
    const urlParams = new URLSearchParams(queryStr || '');
    const level = urlParams.get('level') || body.level || 'file';
    return await window.electronAPI.dbQuery('dependency-graph', level);
  }
  if (pathOnly.startsWith('/api/vibe/') && method === 'POST') {
    if (!googleId) return null;
    const cmd = body.cmd || '';
    return await window.electronAPI.dbQuery('vibe-git', googleId, cmd, body);
  }


  // ── Upload file serving (replaces Flask's /uploads/ route) ──
  if (pathOnly.startsWith('/uploads/') && method === 'GET') {
    const filename = pathOnly.slice('/uploads/'.length);
    return await window.electronAPI.dbQuery('serve-upload', filename);
  }

  // ── Spinners.json (static file) ──
  if (pathOnly === '/spinners.json' && method === 'GET') {
    return [];
  }

  // ── Neuralook (gaze tracking) ──
  if (pathOnly === '/api/neuralook/save-calibration' && method === 'POST') {
    return await window.electronAPI.dbQuery('neuralook-save-calibration', body);
  }
  if (pathOnly === '/api/neuralook/implicit-samples' && method === 'GET') {
    return await window.electronAPI.dbQuery('neuralook-implicit-samples', 'get');
  }
  if (pathOnly === '/api/neuralook/implicit-samples' && method === 'POST') {
    return await window.electronAPI.dbQuery('neuralook-implicit-samples', 'post', body);
  }
  if (pathOnly === '/api/neuralook/refine-history' && method === 'GET') {
    return await window.electronAPI.dbQuery('neuralook-refine-history');
  }
  if (pathOnly === '/api/neuralook/train' && method === 'POST') {
    return await window.electronAPI.dbQuery('neuralook-train', body, true);
  }
  if (pathOnly === '/api/neuralook/predict' && method === 'POST') {
    return await window.electronAPI.dbQuery('neuralook-predict', body);
  }
  if (pathOnly === '/api/neuralook/reset-hidden' && method === 'POST') {
    const m = body.method || 'cnn';
    return await window.electronAPI.dbQuery('neuralook-reset-hidden', m);
  }
  if (pathOnly === '/api/neuralook/auto-refine' && method === 'POST') {
    return await window.electronAPI.dbQuery('neuralook-auto-refine', body, true);
  }

  // ── Living Context ──
  if (pathOnly === '/api/context/list' && method === 'GET') {
    return await window.electronAPI.dbQuery('context-list');
  }
  if (pathOnly === '/api/context/read' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('context-read', urlParams.get('file') || 'main.md');
  }
  if (pathOnly === '/api/context/update' && method === 'POST') {
    return await window.electronAPI.dbQuery('context-update', body);
  }
  if (pathOnly === '/api/context/compact' && method === 'POST') {
    return await window.electronAPI.dbQuery('context-compact', body.file || 'main.md');
  }
  if (pathOnly === '/api/context/create' && method === 'POST') {
    return await window.electronAPI.dbQuery('context-create', body.file);
  }
  if (pathOnly.match(/^\/api\/context\/[^/]+$/) && method === 'DELETE') {
    const file = decodeURIComponent(pathOnly.split('/').pop());
    return await window.electronAPI.dbQuery('context-delete', file);
  }

  // ── Chat memory ──
  if (pathOnly === '/api/chat-memory' && method === 'POST') {
    return await window.electronAPI.dbQuery('chat-memory-save', body);
  }
  if (pathOnly === '/api/chat-memories' && method === 'GET') {
    const urlParams = new URLSearchParams(queryStr || '');
    return await window.electronAPI.dbQuery('chat-memory-list', urlParams.get('query') || undefined);
  }
  if (pathOnly === '/api/chat-memories/stats' && method === 'GET') {
    return await window.electronAPI.dbQuery('chat-memory-stats');
  }

  // Unknown route — log and return null (should not happen in normal usage)
  logger.warn('[api-ipc] Unhandled route:', method, path);
  return null;
}

/** Get the auth token from localStorage */
function _getAuthToken() {
  try {
    return localStorage.getItem('authToken') || null;
  } catch (e) { logger.warn('[api-ipc] Auth token read failed:', e); }
  return null;
}

/** Get the current user's google_id from localStorage session */
export function _getGoogleId() {
  try {
    const userData = Settings.get('user');
    if (userData) {
      const user = JSON.parse(userData);
      if (user.google_id || user.googleId) return user.google_id || user.googleId;
    }
  } catch (e) { logger.warn('[api-ipc] Google ID parse failed (user key):', e); }
  // Fallback: check authUserInfo (set during login before 'user' key exists)
  try {
    const authInfo = localStorage.getItem('authUserInfo');
    if (authInfo) {
      const info = JSON.parse(authInfo);
      if (info.google_id) return info.google_id;
    }
  } catch (e) { logger.warn('[api-ipc] Google ID parse failed (authUserInfo):', e); }
  return null;
}
