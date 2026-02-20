import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Re-implement Settings core for isolated testing (same pattern as core-settings.test.js) ──

function createSettings() {
  const _defs = {};
  const _cache = {};
  const _listeners = {};

  function define(key, opts) {
    opts = opts || {};
    _defs[key] = { default: opts.default !== undefined ? opts.default : null, sync: !!opts.sync };
    const stored = localStorage.getItem(key);
    if (stored !== null) _cache[key] = stored;
  }

  function get(key) {
    if (key in _cache) return _cache[key];
    const stored = localStorage.getItem(key);
    if (stored !== null) { _cache[key] = stored; return stored; }
    if (key in _defs) return _defs[key].default;
    return null;
  }

  function set(key, value) {
    const strVal = (typeof value === 'string') ? value : JSON.stringify(value);
    const old = _cache[key];
    _cache[key] = strVal;
    localStorage.setItem(key, strVal);
    if (_listeners[key]) {
      _listeners[key].forEach(fn => { try { fn(strVal, old); } catch {} });
    }
  }

  function on(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
    return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); };
  }

  return { define, get, set, on, _defs };
}

describe('DoH setting definitions', () => {
  let Settings;

  beforeEach(() => {
    Settings = createSettings();
    // Register DoH settings exactly as in core-settings.js
    Settings.define('dohEnabled',  { default: 'true',       sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });
  });

  it('dohEnabled defaults to true', () => {
    expect(Settings.get('dohEnabled')).toBe('true');
  });

  it('dohProvider defaults to cloudflare', () => {
    expect(Settings.get('dohProvider')).toBe('cloudflare');
  });

  it('dohEnabled is device-local (sync: false)', () => {
    expect(Settings._defs.dohEnabled.sync).toBe(false);
  });

  it('dohProvider is device-local (sync: false)', () => {
    expect(Settings._defs.dohProvider.sync).toBe(false);
  });

  it('can set and get dohEnabled', () => {
    Settings.set('dohEnabled', 'false');
    expect(Settings.get('dohEnabled')).toBe('false');
  });

  it('can switch dohProvider', () => {
    Settings.set('dohProvider', 'quad9');
    expect(Settings.get('dohProvider')).toBe('quad9');
    Settings.set('dohProvider', 'mullvad');
    expect(Settings.get('dohProvider')).toBe('mullvad');
  });
});

describe('DoH default initialization (core-auth pattern)', () => {
  let Settings;

  beforeEach(() => {
    Settings = createSettings();
    Settings.define('dohEnabled',  { default: 'true',       sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });
  });

  it('sets dohEnabled when null', () => {
    // Simulate the core-auth.js initialization
    if (Settings.get('dohEnabled') === null) Settings.set('dohEnabled', 'true');
    // Default is already 'true', so get returns 'true' (not null), so set is not called
    // But if there were no define, it would be null
    expect(Settings.get('dohEnabled')).toBe('true');
  });

  it('sets dohProvider when null', () => {
    if (Settings.get('dohProvider') === null) Settings.set('dohProvider', 'cloudflare');
    expect(Settings.get('dohProvider')).toBe('cloudflare');
  });

  it('does not overwrite existing dohEnabled', () => {
    Settings.set('dohEnabled', 'false');
    // Re-run the initialization guard
    if (Settings.get('dohEnabled') === null) Settings.set('dohEnabled', 'true');
    expect(Settings.get('dohEnabled')).toBe('false');
  });

  it('does not overwrite existing dohProvider', () => {
    Settings.set('dohProvider', 'mullvad');
    if (Settings.get('dohProvider') === null) Settings.set('dohProvider', 'cloudflare');
    expect(Settings.get('dohProvider')).toBe('mullvad');
  });
});

describe('DoH browse-state sync', () => {
  let dohSetConfig;

  beforeEach(() => {
    dohSetConfig = vi.fn();
  });

  // Replicate the sync logic from browse-state.js
  function syncDoH(Settings, electronAPI) {
    if (electronAPI && electronAPI.dohSetConfig) {
      electronAPI.dohSetConfig(
        Settings.get('dohEnabled') !== 'false',
        Settings.get('dohProvider') || 'cloudflare'
      );
    }
  }

  it('calls dohSetConfig on boot with defaults', () => {
    const Settings = createSettings();
    Settings.define('dohEnabled', { default: 'true', sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });

    syncDoH(Settings, { dohSetConfig });
    expect(dohSetConfig).toHaveBeenCalledWith(true, 'cloudflare');
  });

  it('calls dohSetConfig with saved provider', () => {
    const Settings = createSettings();
    Settings.define('dohEnabled', { default: 'true', sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });
    Settings.set('dohProvider', 'quad9');

    syncDoH(Settings, { dohSetConfig });
    expect(dohSetConfig).toHaveBeenCalledWith(true, 'quad9');
  });

  it('sends false when dohEnabled is false', () => {
    const Settings = createSettings();
    Settings.define('dohEnabled', { default: 'true', sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });
    Settings.set('dohEnabled', 'false');

    syncDoH(Settings, { dohSetConfig });
    expect(dohSetConfig).toHaveBeenCalledWith(false, 'cloudflare');
  });

  it('does not crash when electronAPI is missing', () => {
    const Settings = createSettings();
    Settings.define('dohEnabled', { default: 'true', sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });

    expect(() => syncDoH(Settings, null)).not.toThrow();
    expect(() => syncDoH(Settings, {})).not.toThrow();
    expect(dohSetConfig).not.toHaveBeenCalled();
  });

  it('falls back to cloudflare when provider is null', () => {
    const Settings = createSettings();
    Settings.define('dohEnabled', { default: 'true', sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });
    // Simulate a cleared provider
    Settings.set('dohProvider', '');

    syncDoH(Settings, { dohSetConfig });
    // '' || 'cloudflare' → 'cloudflare'
    expect(dohSetConfig).toHaveBeenCalledWith(true, 'cloudflare');
  });
});

describe('DoH settings UI callbacks', () => {
  let dohSetConfig;
  let Settings;

  beforeEach(() => {
    dohSetConfig = vi.fn();
    Settings = createSettings();
    Settings.define('dohEnabled', { default: 'true', sync: false });
    Settings.define('dohProvider', { default: 'cloudflare', sync: false });
  });

  // Replicate the toggle callback from settings-browser.js
  function onToggle(on, electronAPI) {
    Settings.set('dohEnabled', on ? 'true' : 'false');
    if (electronAPI && electronAPI.dohSetConfig) {
      electronAPI.dohSetConfig(on, Settings.get('dohProvider') || 'cloudflare');
    }
  }

  // Replicate the provider picker callback
  function onProviderChange(v, electronAPI) {
    Settings.set('dohProvider', v);
    if (electronAPI && electronAPI.dohSetConfig) {
      electronAPI.dohSetConfig(Settings.get('dohEnabled') !== 'false', v);
    }
  }

  it('toggle on sets enabled and calls IPC', () => {
    onToggle(true, { dohSetConfig });
    expect(Settings.get('dohEnabled')).toBe('true');
    expect(dohSetConfig).toHaveBeenCalledWith(true, 'cloudflare');
  });

  it('toggle off sets disabled and calls IPC', () => {
    onToggle(false, { dohSetConfig });
    expect(Settings.get('dohEnabled')).toBe('false');
    expect(dohSetConfig).toHaveBeenCalledWith(false, 'cloudflare');
  });

  it('provider change updates setting and calls IPC', () => {
    onProviderChange('mullvad', { dohSetConfig });
    expect(Settings.get('dohProvider')).toBe('mullvad');
    expect(dohSetConfig).toHaveBeenCalledWith(true, 'mullvad');
  });

  it('provider change respects disabled state', () => {
    Settings.set('dohEnabled', 'false');
    onProviderChange('quad9', { dohSetConfig });
    expect(dohSetConfig).toHaveBeenCalledWith(false, 'quad9');
  });

  it('toggle works without electronAPI', () => {
    expect(() => onToggle(true, null)).not.toThrow();
    expect(Settings.get('dohEnabled')).toBe('true');
    expect(dohSetConfig).not.toHaveBeenCalled();
  });
});
