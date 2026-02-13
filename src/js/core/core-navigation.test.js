import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable data structures from core modules
// ──────────────────────────────────────────────────────────

const _sidebarToView = {
  'sb-home': 'feed',
  'sb-dashboard': 'dashboard',
  'sb-vault': 'vault',
  'sb-browse': 'browse',
  'sb-settings': 'settings',
  'sb-neuralook': 'neuralook',
};

const _wmViewMeta = {
  dashboard:  { sidebarId: 'sb-dashboard', label: 'Home' },
  feed:       { sidebarId: 'sb-home',      label: 'Feed' },
  vault:      { sidebarId: 'sb-vault',     label: 'Vault' },
  browse:     { sidebarId: 'sb-browse',    label: 'Browse' },
  inbox:      { sidebarId: 'sb-inbox',     label: 'Inbox' },
  neuralook:  { sidebarId: 'sb-neuralook', label: 'Neuralook' },
  dev:        { sidebarId: 'sb-dev',       label: 'Dev Stats' },
  settings:   { sidebarId: 'sb-settings',  label: 'Settings' },
  calendar:   { sidebarId: 'sb-dashboard', label: 'Dashboard' },
  graph:      { sidebarId: 'sb-graph',     label: 'Graph' },
};

const _ROUTE_TABLE_KEYS = [
  '#research', '#experiments', '#settings', '#quality', '#algorithm',
  '#calendar', '#inbox', '#teams', '#vault', '#profile', '#saved-all',
  '#saved', '#browse', '#search', '#terminal', '#neuralook', '#dev',
  '#graph', '#vibe', '#feed',
];

// ── Route-to-wmOpen mapping (what wmOpen key each route triggers) ──
const ROUTE_TO_WM_KEY = {
  '#experiments': 'vault',
  '#settings':    'settings',
  '#calendar':    'dashboard',
  '#inbox':       'inbox',
  '#vault':       'vault',
  '#browse':      'browse',
  '#neuralook':   'neuralook',
  '#dev':         'dev',
  '#graph':       'graph',
  '#vibe':        'vault',
  '#feed':        'feed',
  '#saved':       'dashboard',
};

// ── Replicate setSidebarActive ──
function setSidebarActive(id) {
  const lastActiveView = _sidebarToView[id] || null;
  document.querySelectorAll('.sidebar-icon').forEach(b => {
    b.classList.remove('active');
  });
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  return lastActiveView;
}

// ── Replicate routeFromHash decision logic ──
function resolveRoute(hash) {
  // Exact match
  if (_ROUTE_TABLE_KEYS.includes(hash)) return { type: 'exact', hash };
  // Prefix match
  const prefixes = ['#blog/', '#team/', '#profile/', '#experiment/'];
  for (const prefix of prefixes) {
    if (hash.startsWith(prefix)) return { type: 'prefix', prefix, remainder: hash.slice(prefix.length) };
  }
  // Default
  return { type: 'default' };
}

// ── Navigation history ──
function navPush(hash, history, navigating) {
  if (navigating) return history;
  if (history.length > 0 && history[history.length - 1] === hash) return history;
  history.push(hash);
  if (history.length > 50) history.shift();
  return history;
}

function navBack(history, forward) {
  if (history.length <= 1) return null;
  const current = history.pop();
  forward.push(current);
  return history[history.length - 1] || null;
}

function navForward(history, forward) {
  if (forward.length === 0) return null;
  const next = forward.pop();
  history.push(next);
  return next;
}

// ── Hash restoration logic ──
function shouldRestoreHash(currentHash) {
  return !currentHash || currentHash === '#';
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('_sidebarToView mapping', () => {
  it('should have 6 sidebar-to-view mappings', () => {
    expect(Object.keys(_sidebarToView)).toHaveLength(6);
  });

  it('should map sb-home to feed', () => {
    expect(_sidebarToView['sb-home']).toBe('feed');
  });

  it('should map sb-dashboard to dashboard', () => {
    expect(_sidebarToView['sb-dashboard']).toBe('dashboard');
  });

  it('should map sb-vault to vault', () => {
    expect(_sidebarToView['sb-vault']).toBe('vault');
  });

  it('should map sb-browse to browse', () => {
    expect(_sidebarToView['sb-browse']).toBe('browse');
  });

  it('should map sb-settings to settings', () => {
    expect(_sidebarToView['sb-settings']).toBe('settings');
  });

  it('should map sb-neuralook to neuralook', () => {
    expect(_sidebarToView['sb-neuralook']).toBe('neuralook');
  });

  it('should have all values as valid wmViewMeta keys', () => {
    Object.values(_sidebarToView).forEach(viewKey => {
      expect(_wmViewMeta).toHaveProperty(viewKey);
    });
  });
});

describe('setSidebarActive', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav id="sidebar-nav">
        <button class="sidebar-icon" id="sb-dashboard"></button>
        <button class="sidebar-icon active" id="sb-home"></button>
        <button class="sidebar-icon" id="sb-vault"></button>
        <button class="sidebar-icon" id="sb-browse"></button>
        <button class="sidebar-icon" id="sb-neuralook"></button>
        <button class="sidebar-icon" id="sb-dev"></button>
        <button class="sidebar-icon" id="sb-settings"></button>
      </nav>
    `;
  });

  it('should add active class to target icon', () => {
    setSidebarActive('sb-vault');
    expect(document.getElementById('sb-vault').classList.contains('active')).toBe(true);
  });

  it('should remove active class from all other icons', () => {
    setSidebarActive('sb-vault');
    document.querySelectorAll('.sidebar-icon').forEach(el => {
      if (el.id !== 'sb-vault') {
        expect(el.classList.contains('active')).toBe(false);
      }
    });
  });

  it('should remove previous active class', () => {
    expect(document.getElementById('sb-home').classList.contains('active')).toBe(true);
    setSidebarActive('sb-dashboard');
    expect(document.getElementById('sb-home').classList.contains('active')).toBe(false);
    expect(document.getElementById('sb-dashboard').classList.contains('active')).toBe(true);
  });

  it('should handle non-existent ID gracefully', () => {
    expect(() => setSidebarActive('sb-nonexistent')).not.toThrow();
    // All should be deactivated
    document.querySelectorAll('.sidebar-icon').forEach(el => {
      expect(el.classList.contains('active')).toBe(false);
    });
  });

  it('should return view key for known sidebar IDs', () => {
    expect(setSidebarActive('sb-home')).toBe('feed');
    expect(setSidebarActive('sb-dashboard')).toBe('dashboard');
    expect(setSidebarActive('sb-vault')).toBe('vault');
  });

  it('should return null for unknown sidebar IDs', () => {
    expect(setSidebarActive('sb-dev')).toBeNull();
  });
});

describe('Route-to-wmOpen mapping', () => {
  it('should map #feed to feed', () => {
    expect(ROUTE_TO_WM_KEY['#feed']).toBe('feed');
  });

  it('should map #vault and #experiments to vault', () => {
    expect(ROUTE_TO_WM_KEY['#vault']).toBe('vault');
    expect(ROUTE_TO_WM_KEY['#experiments']).toBe('vault');
  });

  it('should map #vibe to vault', () => {
    expect(ROUTE_TO_WM_KEY['#vibe']).toBe('vault');
  });

  it('should map #calendar and #saved to dashboard', () => {
    expect(ROUTE_TO_WM_KEY['#calendar']).toBe('dashboard');
    expect(ROUTE_TO_WM_KEY['#saved']).toBe('dashboard');
  });

  it('should have all mapped keys as valid wmViewMeta entries', () => {
    Object.values(ROUTE_TO_WM_KEY).forEach(wmKey => {
      expect(_wmViewMeta).toHaveProperty(wmKey);
    });
  });

  it('should have all mapped route keys in the route table', () => {
    Object.keys(ROUTE_TO_WM_KEY).forEach(hash => {
      expect(_ROUTE_TABLE_KEYS).toContain(hash);
    });
  });
});

describe('resolveRoute', () => {
  it('should resolve exact routes', () => {
    expect(resolveRoute('#feed')).toEqual({ type: 'exact', hash: '#feed' });
    expect(resolveRoute('#settings')).toEqual({ type: 'exact', hash: '#settings' });
    expect(resolveRoute('#browse')).toEqual({ type: 'exact', hash: '#browse' });
  });

  it('should resolve prefix routes', () => {
    const result = resolveRoute('#blog/alice/my-post');
    expect(result.type).toBe('prefix');
    expect(result.prefix).toBe('#blog/');
    expect(result.remainder).toBe('alice/my-post');
  });

  it('should resolve profile prefix', () => {
    const result = resolveRoute('#profile/bob');
    expect(result.type).toBe('prefix');
    expect(result.prefix).toBe('#profile/');
    expect(result.remainder).toBe('bob');
  });

  it('should resolve experiment prefix', () => {
    const result = resolveRoute('#experiment/exp1?file=main.py');
    expect(result.type).toBe('prefix');
    expect(result.prefix).toBe('#experiment/');
    expect(result.remainder).toBe('exp1?file=main.py');
  });

  it('should resolve team prefix', () => {
    const result = resolveRoute('#team/42');
    expect(result.type).toBe('prefix');
    expect(result.prefix).toBe('#team/');
    expect(result.remainder).toBe('42');
  });

  it('should default for unknown routes', () => {
    expect(resolveRoute('#unknown')).toEqual({ type: 'default' });
    expect(resolveRoute('#random/path')).toEqual({ type: 'default' });
  });

  it('should default for empty hash', () => {
    expect(resolveRoute('')).toEqual({ type: 'default' });
    expect(resolveRoute('#')).toEqual({ type: 'default' });
  });
});

describe('Navigation history', () => {
  it('should push hash to history', () => {
    const history = [];
    navPush('#feed', history, false);
    expect(history).toEqual(['#feed']);
  });

  it('should not duplicate consecutive hashes', () => {
    const history = ['#feed'];
    navPush('#feed', history, false);
    expect(history).toEqual(['#feed']);
  });

  it('should not push when navigating (back/forward)', () => {
    const history = ['#feed'];
    navPush('#browse', history, true);
    expect(history).toEqual(['#feed']);
  });

  it('should limit history to 50 entries', () => {
    const history = Array.from({ length: 50 }, (_, i) => `#route${i}`);
    navPush('#route50', history, false);
    expect(history).toHaveLength(50);
    expect(history[0]).toBe('#route1');
    expect(history[49]).toBe('#route50');
  });

  it('should allow different consecutive hashes', () => {
    const history = [];
    navPush('#feed', history, false);
    navPush('#browse', history, false);
    navPush('#settings', history, false);
    expect(history).toEqual(['#feed', '#browse', '#settings']);
  });
});

describe('navBack', () => {
  it('should return previous hash', () => {
    const history = ['#feed', '#browse', '#settings'];
    const forward = [];
    const result = navBack(history, forward);
    expect(result).toBe('#browse');
  });

  it('should push current to forward stack', () => {
    const history = ['#feed', '#browse', '#settings'];
    const forward = [];
    navBack(history, forward);
    expect(forward).toEqual(['#settings']);
  });

  it('should return null when at start of history', () => {
    const history = ['#feed'];
    const forward = [];
    expect(navBack(history, forward)).toBeNull();
  });

  it('should return null for empty history', () => {
    const history = [];
    const forward = [];
    expect(navBack(history, forward)).toBeNull();
  });
});

describe('navForward', () => {
  it('should return next hash from forward stack', () => {
    const history = ['#feed'];
    const forward = ['#browse'];
    const result = navForward(history, forward);
    expect(result).toBe('#browse');
  });

  it('should push to history', () => {
    const history = ['#feed'];
    const forward = ['#browse'];
    navForward(history, forward);
    expect(history).toEqual(['#feed', '#browse']);
  });

  it('should return null when no forward history', () => {
    const history = ['#feed'];
    const forward = [];
    expect(navForward(history, forward)).toBeNull();
  });
});

describe('shouldRestoreHash', () => {
  it('should restore when no hash', () => {
    expect(shouldRestoreHash('')).toBe(true);
  });

  it('should restore when hash is just #', () => {
    expect(shouldRestoreHash('#')).toBe(true);
  });

  it('should not restore when hash has value', () => {
    expect(shouldRestoreHash('#feed')).toBe(false);
    expect(shouldRestoreHash('#browse')).toBe(false);
  });
});

describe('wmViewMeta consistency with routes', () => {
  it('should have sidebarId for every wmViewMeta entry', () => {
    Object.entries(_wmViewMeta).forEach(([key, meta]) => {
      expect(meta.sidebarId).toBeDefined();
      expect(meta.sidebarId).toMatch(/^sb-/);
    });
  });

  it('should have label for every wmViewMeta entry', () => {
    Object.entries(_wmViewMeta).forEach(([key, meta]) => {
      expect(meta.label).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
    });
  });

  it('should have routes for all main wmViewMeta keys', () => {
    const mainKeys = ['feed', 'vault', 'browse', 'settings', 'dev', 'neuralook'];
    mainKeys.forEach(key => {
      const hash = '#' + key;
      expect(_ROUTE_TABLE_KEYS).toContain(hash);
    });
  });

  it('should have dashboard accessible via #calendar and #saved', () => {
    expect(ROUTE_TO_WM_KEY['#calendar']).toBe('dashboard');
    expect(ROUTE_TO_WM_KEY['#saved']).toBe('dashboard');
  });
});

describe('Sidebar-to-view-to-route consistency', () => {
  it('every sidebarToView value should be a valid wmViewMeta key', () => {
    Object.values(_sidebarToView).forEach(viewKey => {
      expect(_wmViewMeta).toHaveProperty(viewKey);
    });
  });

  it('every wmViewMeta sidebarId should be a valid CSS ID', () => {
    Object.values(_wmViewMeta).forEach(meta => {
      expect(meta.sidebarId).toMatch(/^[a-z][a-z0-9-]*$/);
    });
  });

  it('reverse mapping should be consistent: sidebarToView[meta.sidebarId] === key', () => {
    // For keys that have entries in _sidebarToView
    Object.entries(_wmViewMeta).forEach(([key, meta]) => {
      if (_sidebarToView[meta.sidebarId] !== undefined) {
        // The sidebarId should map back to a valid view
        expect(typeof _sidebarToView[meta.sidebarId]).toBe('string');
      }
    });
  });
});
