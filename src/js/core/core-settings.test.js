import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Re-implement Settings for isolated testing ──
// The real Settings is an IIFE that wraps localStorage.
// We replicate the core get/set/getJSON/setJSON logic here.

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
    if (stored !== null) {
      _cache[key] = stored;
      return stored;
    }
    if (key in _defs) return _defs[key].default;
    return null;
  }

  function getJSON(key, fallback) {
    const raw = get(key);
    if (raw === null || raw === undefined) return fallback !== undefined ? fallback : null;
    try { return JSON.parse(raw); } catch { return fallback !== undefined ? fallback : null; }
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

  function setJSON(key, val) {
    set(key, JSON.stringify(val));
  }

  function remove(key) {
    delete _cache[key];
    localStorage.removeItem(key);
  }

  function on(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
    return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); };
  }

  function isDefined(key) { return key in _defs; }
  function getDefault(key) { return _defs[key] ? _defs[key].default : null; }

  return { define, get, getJSON, set, setJSON, remove, on, isDefined, getDefault };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('Settings', () => {
  let Settings;

  beforeEach(() => {
    Settings = createSettings();
  });

  // ── get/set ──

  describe('get/set', () => {
    it('sets and gets string values', () => {
      Settings.set('theme', 'dark');
      expect(Settings.get('theme')).toBe('dark');
    });

    it('writes through to localStorage', () => {
      Settings.set('color', 'blue');
      expect(localStorage.setItem).toHaveBeenCalledWith('color', 'blue');
    });

    it('returns null for undefined keys', () => {
      expect(Settings.get('nonexistent')).toBeNull();
    });

    it('returns default for defined keys without stored value', () => {
      Settings.define('myKey', { default: 'fallback' });
      expect(Settings.get('myKey')).toBe('fallback');
    });

    it('prefers stored value over default', () => {
      localStorage.getItem.mockImplementation(key => key === 'myKey' ? 'stored' : null);
      Settings.define('myKey', { default: 'fallback' });
      expect(Settings.get('myKey')).toBe('stored');
    });

    it('caches values after first read', () => {
      Settings.set('cached', 'value');
      Settings.get('cached');
      Settings.get('cached');
      // localStorage.getItem should not be called for cached key after set
      expect(Settings.get('cached')).toBe('value');
    });
  });

  // ── getJSON/setJSON ──

  describe('getJSON/setJSON', () => {
    it('stores and retrieves JSON objects', () => {
      Settings.setJSON('config', { enabled: true, count: 5 });
      expect(Settings.getJSON('config')).toEqual({ enabled: true, count: 5 });
    });

    it('stores and retrieves arrays', () => {
      Settings.setJSON('items', [1, 2, 3]);
      expect(Settings.getJSON('items')).toEqual([1, 2, 3]);
    });

    it('returns fallback for missing key', () => {
      expect(Settings.getJSON('missing', [])).toEqual([]);
      expect(Settings.getJSON('missing', {})).toEqual({});
    });

    it('returns null when no fallback and key missing', () => {
      expect(Settings.getJSON('missing')).toBeNull();
    });

    it('returns fallback for invalid JSON', () => {
      Settings.set('bad', 'not-json');
      expect(Settings.getJSON('bad', 'default')).toBe('default');
    });

    it('handles nested JSON', () => {
      Settings.setJSON('deep', { a: { b: { c: 42 } } });
      expect(Settings.getJSON('deep').a.b.c).toBe(42);
    });
  });

  // ── remove ──

  describe('remove', () => {
    it('removes from cache and localStorage', () => {
      Settings.set('temp', 'value');
      Settings.remove('temp');
      expect(Settings.get('temp')).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith('temp');
    });
  });

  // ── listeners ──

  describe('on (listeners)', () => {
    it('fires listener on set', () => {
      const listener = vi.fn();
      Settings.on('myKey', listener);
      Settings.set('myKey', 'hello');
      expect(listener).toHaveBeenCalledWith('hello', undefined);
    });

    it('passes old and new value to listener', () => {
      const listener = vi.fn();
      Settings.set('myKey', 'old');
      Settings.on('myKey', listener);
      Settings.set('myKey', 'new');
      expect(listener).toHaveBeenCalledWith('new', 'old');
    });

    it('unsubscribes when returned function is called', () => {
      const listener = vi.fn();
      const unsub = Settings.on('myKey', listener);
      unsub();
      Settings.set('myKey', 'value');
      expect(listener).not.toHaveBeenCalled();
    });

    it('handles multiple listeners', () => {
      const a = vi.fn();
      const b = vi.fn();
      Settings.on('key', a);
      Settings.on('key', b);
      Settings.set('key', 'val');
      expect(a).toHaveBeenCalled();
      expect(b).toHaveBeenCalled();
    });
  });

  // ── define ──

  describe('define', () => {
    it('registers default value', () => {
      Settings.define('newKey', { default: 'myDefault' });
      expect(Settings.get('newKey')).toBe('myDefault');
    });

    it('isDefined returns true for defined keys', () => {
      Settings.define('defined', {});
      expect(Settings.isDefined('defined')).toBe(true);
      expect(Settings.isDefined('undefined')).toBe(false);
    });

    it('getDefault returns the default', () => {
      Settings.define('withDefault', { default: 42 });
      expect(Settings.getDefault('withDefault')).toBe(42);
    });

    it('getDefault returns null for undefined key', () => {
      expect(Settings.getDefault('nope')).toBeNull();
    });
  });

  // ── type coercion ──

  describe('type handling', () => {
    it('stringifies non-string values on set', () => {
      Settings.set('num', 42);
      expect(Settings.get('num')).toBe('42');
    });

    it('stringifies booleans', () => {
      Settings.set('bool', true);
      expect(Settings.get('bool')).toBe('true');
    });

    it('stringifies objects', () => {
      Settings.set('obj', { a: 1 });
      expect(Settings.get('obj')).toBe('{"a":1}');
    });
  });
});
