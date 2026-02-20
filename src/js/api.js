// ── Centralized API client ──
// apiGet/apiPost/apiPut/apiDelete go through IPC (api-ipc.js) exclusively.
// The raw api() function is kept for direct callers needing streaming or AbortController.

import { ipcRoute } from '/js/api-ipc.js';

export async function api(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: { ...window._authHeaders(), ...opts.headers },
  });
  if (resp.status === 401) { if (typeof _showLoginGate === 'function') _showLoginGate(); else window.location.href = '/login.html'; throw new Error('Unauthorized'); }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp;
}

export async function apiGet(path) {
  return ipcRoute(path, { method: 'GET' });
}

export async function apiPost(path, body) {
  return ipcRoute(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut(path, body) {
  return ipcRoute(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete(path) {
  return ipcRoute(path, { method: 'DELETE' });
}

