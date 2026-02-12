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

async function apiStream(path, body, { onEvent, onDone, onError }) {
  try {
    const resp = await api(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') { if (onDone) onDone(); return; }
          try { if (onEvent) onEvent(JSON.parse(data)); }
          catch { if (onEvent) onEvent(data); }
        }
      }
    }
    if (onDone) onDone();
  } catch (err) {
    if (onError) onError(err);
    else throw err;
  }
}
