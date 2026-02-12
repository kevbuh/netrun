// ── Centralized API client ──
// Thin wrappers around fetch() that handle auth headers, JSON, and error checking.
// Loaded right after core.js so all other modules can use these globals.

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: { ..._authHeaders(), ...opts.headers },
  });
  if (resp.status === 401) { _showLoginGate(); throw new Error('Unauthorized'); }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp;
}

async function apiGet(path)        { return (await api(path)).json(); }
async function apiPost(path, body) { return (await api(path, { method: 'POST', body: JSON.stringify(body) })).json(); }
async function apiPut(path, body)  { return (await api(path, { method: 'PUT', body: JSON.stringify(body) })).json(); }
async function apiDelete(path)     { return api(path, { method: 'DELETE' }); }

