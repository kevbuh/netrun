const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Re-implement DoH logic from electron/main.js for isolated testing ──
// The real code lives inside main.js and isn't exported, so we replicate
// the pure logic here (same pattern as password-store tests).

const DOH_PROVIDERS = {
  cloudflare: 'https://1.1.1.1/dns-query',
  quad9:      'https://9.9.9.9/dns-query',
  mullvad:    'https://194.242.2.4/dns-query',
};

function applyDoH(enabled, provider, configureFn) {
  const server = DOH_PROVIDERS[provider] || DOH_PROVIDERS.cloudflare;
  const config = {
    secureDnsMode: enabled ? 'secure' : 'off',
    secureDnsServers: enabled ? [server] : [],
  };
  configureFn(config);
  return config;
}

describe('DOH_PROVIDERS', () => {
  it('contains cloudflare, quad9, and mullvad', () => {
    assert.ok(DOH_PROVIDERS.cloudflare);
    assert.ok(DOH_PROVIDERS.quad9);
    assert.ok(DOH_PROVIDERS.mullvad);
    assert.equal(Object.keys(DOH_PROVIDERS).length, 3);
  });

  it('does not include Google DNS', () => {
    assert.equal(DOH_PROVIDERS.google, undefined);
    const urls = Object.values(DOH_PROVIDERS);
    assert.ok(urls.every(u => !u.includes('google')));
  });

  it('all URLs are valid HTTPS dns-query endpoints', () => {
    for (const [name, url] of Object.entries(DOH_PROVIDERS)) {
      assert.ok(url.startsWith('https://'), `${name} should use HTTPS`);
      assert.ok(url.endsWith('/dns-query'), `${name} should end with /dns-query`);
    }
  });
});

describe('applyDoH', () => {
  it('enables secure mode with cloudflare by default', () => {
    let called = null;
    const config = applyDoH(true, 'cloudflare', (c) => { called = c; });
    assert.equal(config.secureDnsMode, 'secure');
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.cloudflare]);
    assert.deepStrictEqual(called, config);
  });

  it('disables DoH when enabled=false', () => {
    const config = applyDoH(false, 'cloudflare', () => {});
    assert.equal(config.secureDnsMode, 'off');
    assert.deepStrictEqual(config.secureDnsServers, []);
  });

  it('selects quad9 provider', () => {
    const config = applyDoH(true, 'quad9', () => {});
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.quad9]);
  });

  it('selects mullvad provider', () => {
    const config = applyDoH(true, 'mullvad', () => {});
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.mullvad]);
  });

  it('falls back to cloudflare for unknown provider', () => {
    const config = applyDoH(true, 'unknown-provider', () => {});
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.cloudflare]);
  });

  it('falls back to cloudflare for null provider', () => {
    const config = applyDoH(true, null, () => {});
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.cloudflare]);
  });

  it('falls back to cloudflare for undefined provider', () => {
    const config = applyDoH(true, undefined, () => {});
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.cloudflare]);
  });

  it('uses secure mode when enabled', () => {
    const config = applyDoH(true, 'cloudflare', () => {});
    assert.equal(config.secureDnsMode, 'secure');
  });

  it('disabled mode returns empty servers array', () => {
    const config = applyDoH(false, 'quad9', () => {});
    assert.equal(config.secureDnsServers.length, 0);
    assert.equal(config.secureDnsMode, 'off');
  });

  it('calls configureFn exactly once', () => {
    let callCount = 0;
    applyDoH(true, 'cloudflare', () => { callCount++; });
    assert.equal(callCount, 1);
  });
});

describe('IPC handler coercion', () => {
  // Mirrors: ipcMain.handle('doh-set-config', (_, enabled, provider) => applyDoH(!!enabled, provider || 'cloudflare'))
  function ipcHandler(enabled, provider) {
    return applyDoH(!!enabled, provider || 'cloudflare', () => {});
  }

  it('coerces truthy enabled to true', () => {
    const config = ipcHandler(1, 'cloudflare');
    assert.equal(config.secureDnsMode, 'secure');
  });

  it('coerces falsy enabled to false', () => {
    const config = ipcHandler(0, 'cloudflare');
    assert.equal(config.secureDnsMode, 'off');
  });

  it('coerces null enabled to false', () => {
    const config = ipcHandler(null, 'cloudflare');
    assert.equal(config.secureDnsMode, 'off');
  });

  it('defaults null provider to cloudflare', () => {
    const config = ipcHandler(true, null);
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.cloudflare]);
  });

  it('defaults undefined provider to cloudflare', () => {
    const config = ipcHandler(true, undefined);
    assert.deepStrictEqual(config.secureDnsServers, [DOH_PROVIDERS.cloudflare]);
  });
});
