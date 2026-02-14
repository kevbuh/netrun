// ── Centralized API client ──
// Thin wrappers around fetch() that handle auth headers, JSON, and error checking.
// When the core TypeScript backend is available via IPC, routes are intercepted
// and handled directly without going through Flask.

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
  // Try IPC first
  if (typeof ipcRoute === 'function') {
    const result = await ipcRoute(path, { method: 'GET' });
    if (result !== null) return result;
  }
  return (await api(path)).json();
}

async function apiPost(path, body) {
  // Try IPC first
  if (typeof ipcRoute === 'function') {
    const result = await ipcRoute(path, { method: 'POST', body: JSON.stringify(body) });
    if (result !== null) return result;
  }
  return (await api(path, { method: 'POST', body: JSON.stringify(body) })).json();
}

async function apiPut(path, body) {
  // Try IPC first
  if (typeof ipcRoute === 'function') {
    const result = await ipcRoute(path, { method: 'PUT', body: JSON.stringify(body) });
    if (result !== null) return result;
  }
  return (await api(path, { method: 'PUT', body: JSON.stringify(body) })).json();
}

async function apiDelete(path) {
  // Try IPC first
  if (typeof ipcRoute === 'function') {
    const result = await ipcRoute(path, { method: 'DELETE' });
    if (result !== null) return result;
  }
  return api(path, { method: 'DELETE' });
}
