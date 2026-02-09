/**
 * Password store — encrypted CRUD backed by Electron safeStorage.
 *
 * Usage (in main process):
 *   const { createPasswordStore } = require('./password-store');
 *   const store = createPasswordStore({ fs, safeStorage, filePath, crypto });
 */

function createPasswordStore({ fs, safeStorage, filePath, crypto }) {
  function _read() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return { version: 1, entries: [] };
      if (!fs.existsSync(filePath)) return { version: 1, entries: [] };
      const encrypted = fs.readFileSync(filePath);
      const json = safeStorage.decryptString(encrypted);
      return JSON.parse(json);
    } catch (e) {
      return { version: 1, entries: [] };
    }
  }

  function _write(data) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const encrypted = safeStorage.encryptString(JSON.stringify(data));
      fs.writeFileSync(filePath, encrypted);
    } catch (e) { /* no-op */ }
  }

  function _genId() {
    return crypto.randomBytes(4).toString('hex');
  }

  function get(origin) {
    const data = _read();
    return data.entries
      .filter(e => e.origin === origin)
      .map(e => ({ id: e.id, origin: e.origin, username: e.username }));
  }

  function fill(id) {
    const data = _read();
    const entry = data.entries.find(e => e.id === id);
    if (!entry) return null;
    return { username: entry.username, password: entry.password };
  }

  function save({ origin, username, password }) {
    const data = _read();
    const existing = data.entries.find(e => e.origin === origin && e.username === username);
    if (existing) {
      existing.password = password;
      existing.updatedAt = new Date().toISOString();
      _write(data);
      return { id: existing.id };
    }
    const id = _genId();
    data.entries.push({
      id, origin, username, password,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    _write(data);
    return { id };
  }

  function remove(id) {
    const data = _read();
    data.entries = data.entries.filter(e => e.id !== id);
    _write(data);
  }

  function list() {
    const data = _read();
    return data.entries.map(e => ({
      id: e.id, origin: e.origin, username: e.username, createdAt: e.createdAt
    }));
  }

  return { get, fill, save, remove, list };
}

module.exports = { createPasswordStore };
