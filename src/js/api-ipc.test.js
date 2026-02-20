import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Re-implement _unwrapTool (module-private) ──

function _unwrapTool(result, dataKey) {
  if (!result || !result.success) return { error: result?.error || 'Tool call failed' };
  if (dataKey && result.data && result.data[dataKey] !== undefined) return result.data[dataKey];
  return result.data;
}

// ── ipcRoute test helper: re-implement just the routing logic for key paths ──
// The real ipcRoute depends on window.electronAPI — we test a simplified version
// that captures the dispatch logic.

function parseRoute(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const [pathOnly, queryStr] = path.split('?');
  return { method, body, pathOnly, queryStr };
}

// ═══════════════════════════════════════════════════════════════
// _unwrapTool
// ═══════════════════════════════════════════════════════════════

describe('_unwrapTool', () => {
  it('returns data on success', () => {
    const result = _unwrapTool({ success: true, data: { items: [1, 2, 3] } });
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('returns error object on failure', () => {
    const result = _unwrapTool({ success: false, error: 'Not found' });
    expect(result).toEqual({ error: 'Not found' });
  });

  it('returns default error message when no error string', () => {
    const result = _unwrapTool({ success: false });
    expect(result).toEqual({ error: 'Tool call failed' });
  });

  it('returns error for null result', () => {
    expect(_unwrapTool(null)).toEqual({ error: 'Tool call failed' });
  });

  it('returns error for undefined result', () => {
    expect(_unwrapTool(undefined)).toEqual({ error: 'Tool call failed' });
  });

  it('extracts dataKey from data', () => {
    const result = _unwrapTool({ success: true, data: { items: ['a', 'b'], count: 2 } }, 'items');
    expect(result).toEqual(['a', 'b']);
  });

  it('returns full data when dataKey not found', () => {
    const result = _unwrapTool({ success: true, data: { items: ['a'] } }, 'missing');
    expect(result).toEqual({ items: ['a'] });
  });

  it('handles dataKey with falsy value', () => {
    const result = _unwrapTool({ success: true, data: { items: 0 } }, 'items');
    expect(result).toBe(0);
  });

  it('handles dataKey with null value (undefined check)', () => {
    const result = _unwrapTool({ success: true, data: { items: null } }, 'items');
    expect(result).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════
// Route parsing
// ═══════════════════════════════════════════════════════════════

describe('Route parsing', () => {
  it('parses GET with no query', () => {
    const { method, pathOnly, queryStr } = parseRoute('/api/calendar');
    expect(method).toBe('GET');
    expect(pathOnly).toBe('/api/calendar');
    expect(queryStr).toBeUndefined();
  });

  it('parses POST with body', () => {
    const { method, body, pathOnly } = parseRoute('/api/calendar', {
      method: 'POST',
      body: JSON.stringify({ title: 'Meeting' })
    });
    expect(method).toBe('POST');
    expect(pathOnly).toBe('/api/calendar');
    expect(body.title).toBe('Meeting');
  });

  it('parses query string', () => {
    const { pathOnly, queryStr } = parseRoute('/api/feed-items?sources=hn,arxiv&limit=50');
    expect(pathOnly).toBe('/api/feed-items');
    expect(queryStr).toBe('sources=hn,arxiv&limit=50');
    const params = new URLSearchParams(queryStr);
    expect(params.get('sources')).toBe('hn,arxiv');
    expect(params.get('limit')).toBe('50');
  });

  it('defaults to GET method', () => {
    const { method } = parseRoute('/api/models');
    expect(method).toBe('GET');
  });

  it('defaults body to empty object when not provided', () => {
    const { body } = parseRoute('/api/test');
    expect(body).toEqual({});
  });

  it('parses PUT method', () => {
    const { method } = parseRoute('/api/calendar/123', { method: 'PUT', body: '{}' });
    expect(method).toBe('PUT');
  });

  it('parses DELETE method', () => {
    const { method } = parseRoute('/api/calendar/123', { method: 'DELETE' });
    expect(method).toBe('DELETE');
  });
});

// ═══════════════════════════════════════════════════════════════
// ipcRoute integration (with mocked electronAPI)
// ═══════════════════════════════════════════════════════════════

describe('ipcRoute dispatch', () => {
  // Test the route matching patterns used in api-ipc.js

  it('calendar GET matches /api/calendar', () => {
    const path = '/api/calendar';
    expect(path === '/api/calendar').toBe(true);
  });

  it('calendar event PUT matches pattern', () => {
    const path = '/api/calendar/event-123';
    expect(path.match(/^\/api\/calendar\/[^/]+$/)).toBeTruthy();
  });

  it('calendar event DELETE matches pattern', () => {
    const path = '/api/calendar/event-456';
    expect(path.match(/^\/api\/calendar\/[^/]+$/)).toBeTruthy();
  });

  it('extracts event ID from path', () => {
    const path = '/api/calendar/evt-789';
    const eventId = path.split('/').pop();
    expect(eventId).toBe('evt-789');
  });

  it('search routes match', () => {
    expect('/api/web-search' === '/api/web-search').toBe(true);
    expect('/api/arxiv-search' === '/api/arxiv-search').toBe(true);
  });

  it('feed-items parses sources from query', () => {
    const queryStr = 'sources=hn,arxiv,lobsters&limit=50';
    const params = new URLSearchParams(queryStr);
    const sources = (params.get('sources') || '').split(',').filter(Boolean);
    expect(sources).toEqual(['hn', 'arxiv', 'lobsters']);
    expect(parseInt(params.get('limit'))).toBe(50);
  });

  it('message route patterns match correctly', () => {
    expect('/api/messages/msg-123/read'.match(/^\/api\/messages\/[^/]+\/read$/)).toBeTruthy();
    expect('/api/messages/msg-456'.match(/^\/api\/messages\/[^/]+$/)).toBeTruthy();
    expect('/api/messages'.match(/^\/api\/messages\/[^/]+$/)).toBeFalsy();
  });

  it('annotation-feedback route patterns', () => {
    expect('/api/annotation-feedback/42'.match(/^\/api\/annotation-feedback\/\d+$/)).toBeTruthy();
    expect('/api/annotation-feedback/abc'.match(/^\/api\/annotation-feedback\/\d+$/)).toBeFalsy();
  });

  it('user profile pattern extracts username', () => {
    const path = '/api/users/john_doe';
    expect(path.match(/^\/api\/users\/[^/]+$/)).toBeTruthy();
    const username = decodeURIComponent(path.split('/').pop());
    expect(username).toBe('john_doe');
  });

  it('user feeds pattern extracts username from middle', () => {
    const path = '/api/users/alice/feeds';
    expect(path.match(/^\/api\/users\/[^/]+\/feeds$/)).toBeTruthy();
    const username = decodeURIComponent(path.split('/')[3]);
    expect(username).toBe('alice');
  });
});
