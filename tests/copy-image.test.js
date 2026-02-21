const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Extract the core logic from the ipcMain.handle('copy-image-to-clipboard') handler ──
// This mirrors the logic in electron/main.js so we can test it without Electron IPC.

/**
 * Core copy-image logic: fetch image buffer, decode to nativeImage, write to clipboard.
 * Accepts injectable dependencies so we can mock Electron APIs in tests.
 */
async function copyImageToClipboard(url, { netFetch, nativeImage, clipboard }) {
  try {
    if (!url || typeof url !== 'string') return { error: 'Missing url' };
    const resp = await netFetch(url);
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const buf = Buffer.from(await resp.arrayBuffer());
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { error: 'Could not decode image' };
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) { return { error: e.message || String(e) }; }
}

// ── Helpers ──

/** A 1x1 red PNG (smallest valid PNG) */
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==',
  'base64'
);

function mockNativeImage({ empty = false } = {}) {
  return {
    createFromBuffer(buf) {
      return {
        _buf: buf,
        isEmpty() { return empty || buf.length === 0; },
      };
    },
  };
}

function mockClipboard() {
  const written = [];
  return {
    writeImage(img) { written.push(img); },
    _written: written,
  };
}

function mockNetFetch({ status = 200, body = VALID_PNG, throws = null } = {}) {
  return async (url) => {
    if (throws) throw new Error(throws);
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
}

function makeDeps(overrides = {}) {
  return {
    netFetch: overrides.netFetch || mockNetFetch(),
    nativeImage: overrides.nativeImage || mockNativeImage(),
    clipboard: overrides.clipboard || mockClipboard(),
  };
}

// ── Tests ──

describe('copyImageToClipboard', () => {
  it('copies a valid PNG to the clipboard', async () => {
    const deps = makeDeps();
    const result = await copyImageToClipboard('http://example.com/img.png', deps);
    assert.deepStrictEqual(result, { ok: true });
    assert.equal(deps.clipboard._written.length, 1);
    assert.equal(deps.clipboard._written[0]._buf.length, VALID_PNG.length);
  });

  it('returns error for missing url', async () => {
    const result = await copyImageToClipboard('', makeDeps());
    assert.ok(result.error);
    assert.match(result.error, /missing url/i);
  });

  it('returns error for null url', async () => {
    const result = await copyImageToClipboard(null, makeDeps());
    assert.ok(result.error);
  });

  it('returns error on HTTP failure', async () => {
    const deps = makeDeps({ netFetch: mockNetFetch({ status: 404 }) });
    const result = await copyImageToClipboard('http://example.com/missing.png', deps);
    assert.deepStrictEqual(result, { error: 'HTTP 404' });
    assert.equal(deps.clipboard._written.length, 0);
  });

  it('returns error on HTTP 500', async () => {
    const deps = makeDeps({ netFetch: mockNetFetch({ status: 500 }) });
    const result = await copyImageToClipboard('http://example.com/error.png', deps);
    assert.deepStrictEqual(result, { error: 'HTTP 500' });
  });

  it('returns error when nativeImage decodes to empty', async () => {
    const deps = makeDeps({ nativeImage: mockNativeImage({ empty: true }) });
    const result = await copyImageToClipboard('http://example.com/corrupt.png', deps);
    assert.deepStrictEqual(result, { error: 'Could not decode image' });
    assert.equal(deps.clipboard._written.length, 0);
  });

  it('returns error when fetch throws (network error)', async () => {
    const deps = makeDeps({ netFetch: mockNetFetch({ throws: 'net::ERR_FAILED' }) });
    const result = await copyImageToClipboard('http://example.com/img.png', deps);
    assert.ok(result.error);
    assert.match(result.error, /ERR_FAILED/);
  });

  it('handles various image URLs without crashing', async () => {
    const deps = makeDeps();
    const urls = [
      'http://localhost:8000/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fimg.png',
      'https://example.com/path/to/image.jpg?w=800&h=600',
      'http://localhost:8000/api/image-proxy?url=https%3A%2F%2Fcdn.site.com%2Fphoto.webp',
    ];
    for (const url of urls) {
      const result = await copyImageToClipboard(url, deps);
      assert.deepStrictEqual(result, { ok: true });
    }
  });
});
