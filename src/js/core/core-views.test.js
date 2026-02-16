import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable data structures from core-views.js
// ──────────────────────────────────────────────────────────

const VIEW_REGISTRY = {
  'exp-detail-view':     { template: '/views/experiment-detail.html', tier: 2 },
  'dashboard-view':      { template: '/views/dashboard.html', tier: 2 },
  'research-view':       { template: '/views/research.html',  tier: 2 },
  'vault-view':          { template: '/views/vault.html',     tier: 3 },
  'blog-view':           { template: '/views/blog.html',      tier: 2 },
  'settings-view':       { template: '/views/settings.html',  tier: 2 },
  'quality-view':        { template: '/views/quality.html',   tier: 2 },
  'algorithm-view':      { template: '/views/algorithm.html', tier: 2 },
  'inbox-view':          { template: '/views/inbox.html',     tier: 2 },
  'profile-view':        { template: '/views/profile.html',   tier: 2 },
  'author-profile-view': { template: '/views/author-profile.html', tier: 2 },
  'neuralook-view':      { template: '/views/neuralook.html', tier: 2 },
  'dev-stats-view':      { template: '/views/dev.html',      tier: 2 },
};

const _wmDefaultOrder = ['dashboard','feed','vault','browse','neuralook','dev','settings'];

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
};

// ── Replicate ensureView logic for testing ──
const _viewTemplateCache = {};
const _mountedViews = new Set();

async function ensureView(viewId, fetchFn) {
  const existing = document.getElementById(viewId);
  if (existing) return existing;
  const config = VIEW_REGISTRY[viewId];
  if (!config) return null;
  if (!_viewTemplateCache[viewId]) {
    _viewTemplateCache[viewId] = await fetchFn(config.template);
  }
  const div = document.createElement('div');
  div.id = viewId;
  div.className = 'hidden view';
  if (viewId === 'vault-view' || viewId === 'blog-view') div.style.height = '100%';
  if (viewId === 'dashboard-view') div.classList.add('overflow-x-hidden');
  div.innerHTML = _viewTemplateCache[viewId];
  document.getElementById('view-mount').appendChild(div);
  _mountedViews.add(viewId);
  return div;
}

function unmountView(viewId) {
  if (!_mountedViews.has(viewId)) return;
  const el = document.getElementById(viewId);
  if (el) el.remove();
  _mountedViews.delete(viewId);
}

function hideAllViews(mountedViews) {
  document.getElementById('home-main').style.display = 'none';
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
    v.style.display = '';
  });
  // Unmount Tier 2 views to free DOM
  for (const viewId of [...mountedViews]) {
    const config = VIEW_REGISTRY[viewId];
    if (config && config.tier === 2) unmountView(viewId);
  }
}

function goHome(mountedViews) {
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
  for (const viewId of [...mountedViews]) {
    const config = VIEW_REGISTRY[viewId];
    if (config && config.tier === 2) unmountView(viewId);
  }
  document.getElementById('home-main').style.display = '';
  window.location.hash = 'feed';
}

// ── wmOpen logic (simplified for testing) ──
function wmOpen(key, wmWindows, state) {
  const meta = _wmViewMeta[key];
  if (!meta) return state;
  const existIdx = wmWindows.findIndex(w => w.key === key);
  if (existIdx >= 0) {
    state.focusIndex = existIdx;
  } else {
    wmWindows.push({ key, label: meta.label, sidebarId: meta.sidebarId });
    state.focusIndex = wmWindows.length - 1;
  }
  state.lastNavTime = Date.now();
  return state;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('VIEW_REGISTRY', () => {
  it('should have 13 registered views', () => {
    expect(Object.keys(VIEW_REGISTRY)).toHaveLength(13);
  });

  it('should have template paths for all views', () => {
    Object.entries(VIEW_REGISTRY).forEach(([id, config]) => {
      expect(config.template).toMatch(/^\/views\/.+\.html$/);
    });
  });

  it('should have tier for all views', () => {
    Object.entries(VIEW_REGISTRY).forEach(([id, config]) => {
      expect([2, 3]).toContain(config.tier);
    });
  });

  it('should have vault-view as tier 3 (persistent)', () => {
    expect(VIEW_REGISTRY['vault-view'].tier).toBe(3);
  });

  it('should have all other views as tier 2 (unmountable)', () => {
    const tier2Views = Object.entries(VIEW_REGISTRY).filter(([id]) => id !== 'vault-view');
    tier2Views.forEach(([id, config]) => {
      expect(config.tier).toBe(2);
    });
  });

  it('should have unique template paths', () => {
    const templates = Object.values(VIEW_REGISTRY).map(c => c.template);
    const unique = new Set(templates);
    expect(unique.size).toBe(templates.length);
  });

  it('should include all core view IDs', () => {
    expect(VIEW_REGISTRY).toHaveProperty('dashboard-view');
    expect(VIEW_REGISTRY).toHaveProperty('settings-view');
    expect(VIEW_REGISTRY).toHaveProperty('vault-view');
    expect(VIEW_REGISTRY).toHaveProperty('inbox-view');
    expect(VIEW_REGISTRY).toHaveProperty('dev-stats-view');
    expect(VIEW_REGISTRY).toHaveProperty('neuralook-view');
  });
});

describe('_wmViewMeta', () => {
  it('should have 9 view meta entries', () => {
    expect(Object.keys(_wmViewMeta)).toHaveLength(9);
  });

  it('should have sidebarId for all entries', () => {
    Object.entries(_wmViewMeta).forEach(([key, meta]) => {
      expect(meta.sidebarId).toMatch(/^sb-/);
    });
  });

  it('should have label for all entries', () => {
    Object.entries(_wmViewMeta).forEach(([key, meta]) => {
      expect(typeof meta.label).toBe('string');
      expect(meta.label.length).toBeGreaterThan(0);
    });
  });

  it('should map calendar to dashboard sidebar', () => {
    expect(_wmViewMeta.calendar.sidebarId).toBe('sb-dashboard');
  });

  it('should map feed to sb-home sidebar', () => {
    expect(_wmViewMeta.feed.sidebarId).toBe('sb-home');
  });

  it('should have all default order keys in meta', () => {
    _wmDefaultOrder.forEach(key => {
      expect(_wmViewMeta).toHaveProperty(key);
    });
  });
});

describe('_wmDefaultOrder', () => {
  it('should have 7 default windows', () => {
    expect(_wmDefaultOrder).toHaveLength(7);
  });

  it('should start with dashboard', () => {
    expect(_wmDefaultOrder[0]).toBe('dashboard');
  });

  it('should end with settings', () => {
    expect(_wmDefaultOrder[_wmDefaultOrder.length - 1]).toBe('settings');
  });

  it('should have unique entries', () => {
    const unique = new Set(_wmDefaultOrder);
    expect(unique.size).toBe(_wmDefaultOrder.length);
  });

  it('should include feed and browse', () => {
    expect(_wmDefaultOrder).toContain('feed');
    expect(_wmDefaultOrder).toContain('browse');
  });
});

describe('ensureView', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="view-mount"></div>';
    // Clear caches
    Object.keys(_viewTemplateCache).forEach(k => delete _viewTemplateCache[k]);
    _mountedViews.clear();
  });

  it('should return existing element if already in DOM', async () => {
    const existing = document.createElement('div');
    existing.id = 'dashboard-view';
    document.getElementById('view-mount').appendChild(existing);

    const result = await ensureView('dashboard-view', vi.fn());
    expect(result).toBe(existing);
  });

  it('should return null for unknown view ID', async () => {
    const result = await ensureView('nonexistent-view', vi.fn());
    expect(result).toBeNull();
  });

  it('should create view element in view-mount', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Dashboard</p>');
    const result = await ensureView('dashboard-view', fetchFn);

    expect(result).not.toBeNull();
    expect(result.id).toBe('dashboard-view');
    expect(result.parentElement.id).toBe('view-mount');
  });

  it('should add hidden and view classes', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Test</p>');
    const result = await ensureView('settings-view', fetchFn);

    expect(result.classList.contains('hidden')).toBe(true);
    expect(result.classList.contains('view')).toBe(true);
  });

  it('should set height 100% for vault-view', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Vault</p>');
    const result = await ensureView('vault-view', fetchFn);

    expect(result.style.height).toBe('100%');
  });

  it('should set height 100% for blog-view', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Blog</p>');
    const result = await ensureView('blog-view', fetchFn);

    expect(result.style.height).toBe('100%');
  });


  it('should add overflow-x-hidden class for dashboard-view', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Dashboard</p>');
    const result = await ensureView('dashboard-view', fetchFn);

    expect(result.classList.contains('overflow-x-hidden')).toBe(true);
  });

  it('should fetch template with correct path', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Test</p>');
    await ensureView('inbox-view', fetchFn);

    expect(fetchFn).toHaveBeenCalledWith('/views/inbox.html');
  });

  it('should cache template and not re-fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Cached</p>');
    await ensureView('settings-view', fetchFn);

    // Remove from DOM so ensureView will try to create again
    document.getElementById('settings-view').remove();
    _mountedViews.delete('settings-view');

    await ensureView('settings-view', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('should track mounted views', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Test</p>');
    await ensureView('inbox-view', fetchFn);

    expect(_mountedViews.has('inbox-view')).toBe(true);
  });

  it('should set innerHTML from template', async () => {
    const fetchFn = vi.fn().mockResolvedValue('<p>Hello World</p>');
    const result = await ensureView('profile-view', fetchFn);

    expect(result.innerHTML).toBe('<p>Hello World</p>');
  });
});

describe('unmountView', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="view-mount"></div>';
    _mountedViews.clear();
  });

  it('should remove element from DOM', () => {
    const el = document.createElement('div');
    el.id = 'test-view';
    document.getElementById('view-mount').appendChild(el);
    _mountedViews.add('test-view');

    unmountView('test-view');
    expect(document.getElementById('test-view')).toBeNull();
  });

  it('should remove from mounted set', () => {
    const el = document.createElement('div');
    el.id = 'test-view';
    document.getElementById('view-mount').appendChild(el);
    _mountedViews.add('test-view');

    unmountView('test-view');
    expect(_mountedViews.has('test-view')).toBe(false);
  });

  it('should do nothing for non-mounted view', () => {
    unmountView('nonexistent-view');
    // No error thrown
    expect(_mountedViews.size).toBe(0);
  });
});

describe('hideAllViews', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="home-main" style="display: block">Home</div>
      <div id="view-mount">
        <div id="dashboard-view" class="view active" style="display: block">Dashboard</div>
        <div id="settings-view" class="view active">Settings</div>
        <div id="vault-view" class="view active">Vault</div>
      </div>
    `;
    _mountedViews.clear();
    _mountedViews.add('dashboard-view');
    _mountedViews.add('settings-view');
    _mountedViews.add('vault-view');
  });

  it('should hide home-main', () => {
    hideAllViews(_mountedViews);
    expect(document.getElementById('home-main').style.display).toBe('none');
  });

  it('should remove active class from all views', () => {
    hideAllViews(_mountedViews);
    document.querySelectorAll('.view').forEach(v => {
      expect(v.classList.contains('active')).toBe(false);
    });
  });

  it('should add hidden class to all views', () => {
    hideAllViews(_mountedViews);
    document.querySelectorAll('.view').forEach(v => {
      expect(v.classList.contains('hidden')).toBe(true);
    });
  });

  it('should unmount tier 2 views', () => {
    hideAllViews(_mountedViews);
    // dashboard-view and settings-view are tier 2, should be unmounted
    expect(document.getElementById('dashboard-view')).toBeNull();
    expect(document.getElementById('settings-view')).toBeNull();
  });

  it('should preserve tier 3 views (vault)', () => {
    hideAllViews(_mountedViews);
    // vault-view is tier 3, should still exist
    expect(_mountedViews.has('vault-view')).toBe(true);
  });
});

describe('goHome', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="home-main" style="display: none">Home</div>
      <div id="view-mount">
        <div id="dashboard-view" class="view active" style="display: block">Dashboard</div>
      </div>
    `;
    _mountedViews.clear();
    _mountedViews.add('dashboard-view');
    window.location.hash = '';
  });

  it('should show home-main', () => {
    goHome(_mountedViews);
    expect(document.getElementById('home-main').style.display).toBe('');
  });

  it('should remove active class from views', () => {
    goHome(_mountedViews);
    const views = document.querySelectorAll('.view');
    views.forEach(v => {
      expect(v.classList.contains('active')).toBe(false);
    });
  });

  it('should set hash to feed', () => {
    goHome(_mountedViews);
    expect(window.location.hash).toBe('#feed');
  });

  it('should unmount tier 2 views', () => {
    goHome(_mountedViews);
    expect(document.getElementById('dashboard-view')).toBeNull();
    expect(_mountedViews.has('dashboard-view')).toBe(false);
  });
});

describe('wmOpen', () => {
  let wmWindows;
  let state;

  beforeEach(() => {
    wmWindows = _wmDefaultOrder.map(key => ({
      key,
      label: _wmViewMeta[key].label,
      sidebarId: _wmViewMeta[key].sidebarId,
    }));
    state = { focusIndex: 0, lastNavTime: 0 };
  });

  it('should update focusIndex for existing window', () => {
    const result = wmOpen('browse', wmWindows, state);
    const idx = wmWindows.findIndex(w => w.key === 'browse');
    expect(result.focusIndex).toBe(idx);
  });

  it('should add new window for unknown key', () => {
    const initialLength = wmWindows.length;
    wmOpen('inbox', wmWindows, state);
    expect(wmWindows.length).toBe(initialLength + 1);
    expect(wmWindows[wmWindows.length - 1].key).toBe('inbox');
  });

  it('should set focusIndex to new window', () => {
    const result = wmOpen('inbox', wmWindows, state);
    expect(result.focusIndex).toBe(wmWindows.length - 1);
  });

  it('should update lastNavTime', () => {
    const before = Date.now();
    const result = wmOpen('feed', wmWindows, state);
    expect(result.lastNavTime).toBeGreaterThanOrEqual(before);
  });

  it('should not modify state for unknown meta key', () => {
    const result = wmOpen('nonexistent', wmWindows, state);
    expect(result.focusIndex).toBe(0);
  });

  it('should set correct label and sidebarId for new window', () => {
    wmOpen('inbox', wmWindows, state);
    const added = wmWindows[wmWindows.length - 1];
    expect(added.label).toBe('Inbox');
    expect(added.sidebarId).toBe('sb-inbox');
  });

  it('should focus dashboard at index 0', () => {
    const result = wmOpen('dashboard', wmWindows, state);
    expect(result.focusIndex).toBe(0);
  });

  it('should focus settings at last default index', () => {
    const result = wmOpen('settings', wmWindows, state);
    expect(result.focusIndex).toBe(_wmDefaultOrder.indexOf('settings'));
  });
});
