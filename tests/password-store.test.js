const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordStore } = require('../electron/password-store');

function mockFs() {
  const files = new Map();
  return {
    existsSync(p) { return files.has(p); },
    readFileSync(p) {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    writeFileSync(p, data) { files.set(p, data); },
    _files: files
  };
}

function mockSafeStorage(available = true) {
  return {
    isEncryptionAvailable() { return available; },
    encryptString(s) { return Buffer.from(s, 'utf8'); },
    decryptString(buf) { return buf.toString('utf8'); }
  };
}

function mockCrypto() {
  let counter = 0;
  return {
    randomBytes(n) {
      const buf = Buffer.alloc(n);
      const val = ++counter;
      buf.writeUInt32BE(val, 0);
      return buf;
    }
  };
}

function makeStore(opts = {}) {
  return createPasswordStore({
    fs: opts.fs || mockFs(),
    safeStorage: opts.safeStorage || mockSafeStorage(),
    filePath: opts.filePath || '/tmp/test-passwords.enc',
    crypto: opts.crypto || mockCrypto()
  });
}

describe('password-store', () => {
  it('1 — empty store list returns []', () => {
    const store = makeStore();
    assert.deepStrictEqual(store.list(), []);
  });

  it('2 — empty store get returns []', () => {
    const store = makeStore();
    assert.deepStrictEqual(store.get('https://x.com'), []);
  });

  it('3 — save + list shows entry without password', () => {
    const store = makeStore();
    const { id } = store.save({ origin: 'https://example.com', username: 'alice', password: 's3cret' });
    const items = store.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, id);
    assert.equal(items[0].origin, 'https://example.com');
    assert.equal(items[0].username, 'alice');
    assert.ok(items[0].createdAt);
    assert.equal(items[0].password, undefined);
  });

  it('4 — save + fill returns username and password', () => {
    const store = makeStore();
    const { id } = store.save({ origin: 'https://example.com', username: 'alice', password: 's3cret' });
    const cred = store.fill(id);
    assert.deepStrictEqual(cred, { username: 'alice', password: 's3cret' });
  });

  it('5 — fill missing id returns null', () => {
    const store = makeStore();
    assert.equal(store.fill('nonexistent'), null);
  });

  it('6 — get filters by origin', () => {
    const store = makeStore();
    store.save({ origin: 'https://a.com', username: 'u1', password: 'p1' });
    store.save({ origin: 'https://b.com', username: 'u2', password: 'p2' });
    store.save({ origin: 'https://a.com', username: 'u3', password: 'p3' });
    const results = store.get('https://a.com');
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.origin === 'https://a.com'));
  });

  it('7 — get excludes password field', () => {
    const store = makeStore();
    store.save({ origin: 'https://a.com', username: 'u1', password: 'p1' });
    const results = store.get('https://a.com');
    assert.equal(results.length, 1);
    assert.equal(results[0].password, undefined);
    assert.equal(results[0].username, 'u1');
  });

  it('8 — upsert same origin+username updates password', () => {
    const store = makeStore();
    const { id: id1 } = store.save({ origin: 'https://a.com', username: 'alice', password: 'old' });
    const { id: id2 } = store.save({ origin: 'https://a.com', username: 'alice', password: 'new' });
    assert.equal(id1, id2);
    assert.equal(store.list().length, 1);
    const cred = store.fill(id1);
    assert.equal(cred.password, 'new');
  });

  it('9 — remove deletes entry', () => {
    const store = makeStore();
    const { id } = store.save({ origin: 'https://a.com', username: 'u', password: 'p' });
    assert.equal(store.list().length, 1);
    store.remove(id);
    assert.equal(store.list().length, 0);
  });

  it('10 — remove nonexistent does not throw', () => {
    const store = makeStore();
    assert.doesNotThrow(() => store.remove('nope'));
  });

  it('11 — encryption unavailable returns empty, no file writes', () => {
    const fs = mockFs();
    const store = makeStore({ fs, safeStorage: mockSafeStorage(false) });
    store.save({ origin: 'https://a.com', username: 'u', password: 'p' });
    assert.deepStrictEqual(store.list(), []);
    assert.deepStrictEqual(store.get('https://a.com'), []);
    assert.equal(store.fill('any'), null);
    assert.equal(fs._files.size, 0);
  });
});
