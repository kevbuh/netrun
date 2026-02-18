import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable logic from core-auth.js
// ──────────────────────────────────────────────────────────

const SYNC_KEYS = [
  'feedSources', 'customFeeds', 'hiddenPosts', 'savedPosts',
  'readPosts', 'paperRatings', 'theme',
  'accentColor', 'spinner', 'userName', 'sidebarOrder',
  'clickSound', 'clickSoundType', 'clickAether', 'rainNoiseType', 'rainVolume', 'rainFreq',
  'editorTheme', 'rainSidebarVisible',
  'pixelPet', 'pixelPetType', 'pixelPetMode',
  'feedNotifications', 'seenPostLinks',
  'adBlockEnabled', 'feedNotifSources', 'browseBarOrder',
  'browseHistory', 'webSearchHistory', 'chatThreads',
  'aetherColor',
  'interestProfile',
  'urlBarSections',
  'blockedWords', 'searchHistory', 'repostedLinks',
  'fyWeightBase', 'fyWeightAffinity', 'fyWeightRecency', 'maxPerCategoryRun',
  'smartHighlights',
  'chatModel', 'chatTools', 'insightsAllowHeuristics',
  'iconSize', 'hiddenSidebarIcons'
];

// ── Replicate login gate functions ──
function showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = '';
}

function hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = 'none';
}

// ── Replicate auth state management ──
function createAuthState() {
  return {
    token: null,
    user: null,
    userInfo: null,
    ready: false,
  };
}

function onLoginSuccess(authState) {
  authState.ready = true;
  hideLoginGate();
  return authState;
}

function authLogout(authState) {
  authState.token = null;
  authState.user = null;
  authState.userInfo = null;
  authState.ready = false;
  for (const key of SYNC_KEYS) localStorage.removeItem(key);
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  localStorage.removeItem('authUserInfo');
  showLoginGate();
  return authState;
}

// ── Replicate sync payload builder ──
function buildSyncPayload(keysToSync) {
  const data = {};
  const now = Date.now() / 1000;
  for (const key of keysToSync) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      data[key] = { value, updated: now };
    }
  }
  return data;
}

// ── Replicate sync data applier ──
function applySyncData(serverData) {
  const syncKeysSet = new Set(SYNC_KEYS);
  for (const [key, entry] of Object.entries(serverData)) {
    if (!syncKeysSet.has(key)) continue;
    const value = entry.value;
    if (value === null || value === undefined) continue;
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

// ── Replicate localStorage helpers ──
function getLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function setLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── Replicate initAuth decision logic ──
function initAuthDecision(hasToken) {
  if (hasToken) {
    return 'verify-session';
  }
  return 'show-login-gate';
}

function handleVerifySuccess(data) {
  if (!data.username) {
    return 'show-username-picker';
  }
  return 'login-success';
}

function handleVerifyFailure() {
  return 'clear-and-show-gate';
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('SYNC_KEYS', () => {
  it('should have expected number of sync keys', () => {
    expect(SYNC_KEYS.length).toBeGreaterThan(40);
  });

  it('should include appearance settings', () => {
    expect(SYNC_KEYS).toContain('theme');
    expect(SYNC_KEYS).toContain('accentColor');
    expect(SYNC_KEYS).toContain('spinner');
    expect(SYNC_KEYS).toContain('iconSize');
  });

  it('should include feed settings', () => {
    expect(SYNC_KEYS).toContain('feedSources');
    expect(SYNC_KEYS).toContain('customFeeds');
  });

  it('should include user data', () => {
    expect(SYNC_KEYS).toContain('savedPosts');
    expect(SYNC_KEYS).toContain('readPosts');
    expect(SYNC_KEYS).toContain('hiddenPosts');
    expect(SYNC_KEYS).toContain('browseHistory');
  });

  it('should have unique keys', () => {
    const unique = new Set(SYNC_KEYS);
    expect(unique.size).toBe(SYNC_KEYS.length);
  });

  it('should not include auth keys (those are handled separately)', () => {
    expect(SYNC_KEYS).not.toContain('authToken');
    expect(SYNC_KEYS).not.toContain('authUser');
    expect(SYNC_KEYS).not.toContain('authUserInfo');
  });
});

describe('Login Gate DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="login-gate" style="display: none"></div>';
  });

  it('should show login gate', () => {
    showLoginGate();
    expect(document.getElementById('login-gate').style.display).toBe('');
  });

  it('should hide login gate', () => {
    document.getElementById('login-gate').style.display = '';
    hideLoginGate();
    expect(document.getElementById('login-gate').style.display).toBe('none');
  });

  it('should handle missing login gate element gracefully', () => {
    document.body.innerHTML = '';
    expect(() => showLoginGate()).not.toThrow();
    expect(() => hideLoginGate()).not.toThrow();
  });

  it('should toggle login gate visibility', () => {
    showLoginGate();
    expect(document.getElementById('login-gate').style.display).toBe('');
    hideLoginGate();
    expect(document.getElementById('login-gate').style.display).toBe('none');
    showLoginGate();
    expect(document.getElementById('login-gate').style.display).toBe('');
  });
});

describe('Auth State', () => {
  it('should initialize with null/false values', () => {
    const state = createAuthState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.userInfo).toBeNull();
    expect(state.ready).toBe(false);
  });
});

describe('onLoginSuccess', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="login-gate" style="display: block"></div>';
  });

  it('should set authReady to true', () => {
    const state = createAuthState();
    const result = onLoginSuccess(state);
    expect(result.ready).toBe(true);
  });

  it('should hide login gate', () => {
    const state = createAuthState();
    onLoginSuccess(state);
    expect(document.getElementById('login-gate').style.display).toBe('none');
  });

  it('should preserve existing auth data', () => {
    const state = createAuthState();
    state.token = 'my-token';
    state.user = 'alice';
    state.userInfo = { email: 'alice@test.com' };
    const result = onLoginSuccess(state);
    expect(result.token).toBe('my-token');
    expect(result.user).toBe('alice');
    expect(result.userInfo).toEqual({ email: 'alice@test.com' });
  });
});

describe('authLogout', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="login-gate" style="display: none"></div>';
    localStorage.clear();
  });

  it('should clear auth state', () => {
    const state = { token: 'tok', user: 'alice', userInfo: { email: 'a@b.com' }, ready: true };
    const result = authLogout(state);
    expect(result.token).toBeNull();
    expect(result.user).toBeNull();
    expect(result.userInfo).toBeNull();
    expect(result.ready).toBe(false);
  });

  it('should remove auth keys from localStorage', () => {
    localStorage.setItem('authToken', 'tok');
    localStorage.setItem('authUser', 'alice');
    localStorage.setItem('authUserInfo', '{}');

    const state = createAuthState();
    authLogout(state);

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('authUser')).toBeNull();
    expect(localStorage.getItem('authUserInfo')).toBeNull();
  });

  it('should clear all sync keys from localStorage', () => {
    SYNC_KEYS.forEach(key => localStorage.setItem(key, '"test"'));

    const state = createAuthState();
    authLogout(state);

    SYNC_KEYS.forEach(key => {
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  it('should show login gate', () => {
    const state = createAuthState();
    authLogout(state);
    expect(document.getElementById('login-gate').style.display).toBe('');
  });
});

describe('initAuth decision logic', () => {
  it('should verify session when token exists', () => {
    expect(initAuthDecision(true)).toBe('verify-session');
  });

  it('should show login gate when no token', () => {
    expect(initAuthDecision(false)).toBe('show-login-gate');
  });
});

describe('handleVerifySuccess', () => {
  it('should return login-success when username exists', () => {
    expect(handleVerifySuccess({ username: 'alice', email: 'a@b.com' })).toBe('login-success');
  });

  it('should return show-username-picker when no username', () => {
    expect(handleVerifySuccess({ email: 'a@b.com' })).toBe('show-username-picker');
  });

  it('should return show-username-picker when username is null', () => {
    expect(handleVerifySuccess({ username: null, email: 'a@b.com' })).toBe('show-username-picker');
  });
});

describe('handleVerifyFailure', () => {
  it('should return clear-and-show-gate', () => {
    expect(handleVerifyFailure()).toBe('clear-and-show-gate');
  });
});

describe('buildSyncPayload', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should build payload for keys that exist in localStorage', () => {
    localStorage.setItem('theme', '"dark"');
    localStorage.setItem('accentColor', '"blue"');

    const payload = buildSyncPayload(['theme', 'accentColor']);
    expect(payload.theme.value).toBe('dark');
    expect(payload.accentColor.value).toBe('blue');
  });

  it('should skip keys not in localStorage', () => {
    const payload = buildSyncPayload(['nonexistent']);
    expect(payload).toEqual({});
  });

  it('should include updated timestamp', () => {
    localStorage.setItem('theme', '"dark"');
    const before = Date.now() / 1000;
    const payload = buildSyncPayload(['theme']);
    expect(payload.theme.updated).toBeGreaterThanOrEqual(before - 1);
  });

  it('should handle non-JSON values as raw strings', () => {
    localStorage.setItem('theme', 'not-json');
    const payload = buildSyncPayload(['theme']);
    expect(payload.theme.value).toBe('not-json');
  });

  it('should handle arrays', () => {
    localStorage.setItem('feedSources', '["hn","arxiv"]');
    const payload = buildSyncPayload(['feedSources']);
    expect(payload.feedSources.value).toEqual(['hn', 'arxiv']);
  });

  it('should return empty object for empty keys', () => {
    const payload = buildSyncPayload([]);
    expect(payload).toEqual({});
  });
});

describe('applySyncData', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should apply string values', () => {
    applySyncData({ theme: { value: 'dark', updated: 1 } });
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('should apply object values as JSON', () => {
    applySyncData({ feedSources: { value: ['hn', 'arxiv'], updated: 1 } });
    expect(JSON.parse(localStorage.getItem('feedSources'))).toEqual(['hn', 'arxiv']);
  });

  it('should skip null values', () => {
    localStorage.setItem('theme', '"existing"');
    applySyncData({ theme: { value: null, updated: 1 } });
    expect(localStorage.getItem('theme')).toBe('"existing"');
  });

  it('should skip undefined values', () => {
    localStorage.setItem('theme', '"existing"');
    applySyncData({ theme: { value: undefined, updated: 1 } });
    expect(localStorage.getItem('theme')).toBe('"existing"');
  });

  it('should skip keys not in SYNC_KEYS', () => {
    applySyncData({ notASyncKey: { value: 'bad', updated: 1 } });
    expect(localStorage.getItem('notASyncKey')).toBeNull();
  });

  it('should handle multiple keys', () => {
    applySyncData({
      theme: { value: 'dark', updated: 1 },
      spinner: { value: 'dots', updated: 1 },
      accentColor: { value: '#ff0000', updated: 1 },
    });
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('spinner')).toBe('dots');
    expect(localStorage.getItem('accentColor')).toBe('#ff0000');
  });
});

describe('getLS / setLS', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should round-trip string values', () => {
    setLS('testKey', 'hello');
    expect(getLS('testKey', null)).toBe('hello');
  });

  it('should round-trip object values', () => {
    setLS('testKey', { a: 1, b: [2, 3] });
    expect(getLS('testKey', null)).toEqual({ a: 1, b: [2, 3] });
  });

  it('should round-trip array values', () => {
    setLS('testKey', [1, 2, 3]);
    expect(getLS('testKey', null)).toEqual([1, 2, 3]);
  });

  it('should return fallback for missing key', () => {
    expect(getLS('missing', 'default')).toBe('default');
  });

  it('should return fallback for invalid JSON', () => {
    localStorage.setItem('badKey', '{invalid');
    expect(getLS('badKey', 'fallback')).toBe('fallback');
  });

  it('should return fallback for null value', () => {
    localStorage.setItem('nullKey', 'null');
    expect(getLS('nullKey', 'fallback')).toBe('fallback');
  });

  it('should handle boolean values', () => {
    setLS('boolKey', true);
    expect(getLS('boolKey', false)).toBe(true);
  });

  it('should handle numeric values', () => {
    setLS('numKey', 42);
    expect(getLS('numKey', 0)).toBe(42);
  });
});
