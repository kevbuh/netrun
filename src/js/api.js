// ── Centralized API client ──
// apiGet/apiPost/apiPut/apiDelete go through IPC (api-ipc.js) exclusively.
// The raw api() function is kept for direct callers needing streaming or AbortController.

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: { ..._authHeaders(), ...opts.headers },
  });
  if (resp.status === 401) { _showLoginGate(); throw new Error('Unauthorized'); }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp;
}

async function apiGet(path) {
  return ipcRoute(path, { method: 'GET' });
}

async function apiPost(path, body) {
  return ipcRoute(path, { method: 'POST', body: JSON.stringify(body) });
}

async function apiPut(path, body) {
  return ipcRoute(path, { method: 'PUT', body: JSON.stringify(body) });
}

async function apiDelete(path) {
  return ipcRoute(path, { method: 'DELETE' });
}
