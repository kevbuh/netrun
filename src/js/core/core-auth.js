// core-auth.js — Auth system, sync
// Extracted from core.js
if (window.AetherUI) AetherUI.globals();

// ── User accounts & sync ──

// Hydrate token from secure storage (macOS Keychain) if available
if (!_authToken && window.electronAPI?.getAuthToken) {
  window.electronAPI.getAuthToken().then(t => {
    if (t && !_authToken) { _authToken = t; localStorage.setItem('authToken', t); }
  });
}
let _authUser = localStorage.getItem('authUser') || null;  // email or name
let _syncInterval = null;
let _authReady = false;  // true once login gate has been resolved

// Track dirty sync keys so we only serialize changed ones
const _syncDirtyKeys = new Set();
const _syncKeysSet = new Set();
(function() {
  const origSetItem = localStorage.setItem.bind(localStorage);
  const origRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    if (_syncKeysSet.has(key)) _syncDirtyKeys.add(key);
    return origSetItem(key, value);
  };
  localStorage.removeItem = function(key) {
    if (_syncKeysSet.has(key)) _syncDirtyKeys.add(key);
    return origRemoveItem(key);
  };
})();

// Keys to sync between devices (all user settings)
const SYNC_KEYS = [
  'feedSources', 'customFeeds', 'qualityFilter', 'qualityPrompt',
  'qualityThreshold', 'qualityCache', 'hiddenPosts', 'savedPosts',
  'readPosts', 'qualityTestTitles', 'paperRatings', 'theme',
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
  'blockedWords', 'qualityBypass', 'searchHistory', 'userQuotes', 'repostedLinks',
  'fyWeightBase', 'fyWeightAffinity', 'fyWeightRecency', 'maxPerCategoryRun',
  'smartHighlights',
  'chatModel', 'chatTools', 'insightsAllowHeuristics',
  'iconSize', 'hiddenSidebarIcons'
];
SYNC_KEYS.forEach(k => _syncKeysSet.add(k));

// Default ad blocker to enabled
if (localStorage.getItem('adBlockEnabled') === null) {
  localStorage.setItem('adBlockEnabled', 'true');
}


// ── localStorage helpers (reduce try/parse/default boilerplate) ──
function getLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function setLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── Auth fetch helper (reduces fetch+auth+error boilerplate) ──
// ── Login gate (redirects to standalone login page) ──

function _showLoginGate() {
  window.location.href = '/login.html';
}

// ── Auth actions ──

function _onLoginSuccess() {
  _authReady = true;
  _updateAccountUI();
  _startSyncInterval();
  // Apply any synced appearance settings
  if (typeof applyStoredAppearance === 'function') applyStoredAppearance();
  // Refresh inbox badge
  if (typeof refreshInboxBadge === 'function') {
    refreshInboxBadge();
    setInterval(refreshInboxBadge, 60000);
  }
  // Load custom annotation categories
  _loadCustomAnnotationCategories();
  // Calendar event notifications
  if (typeof startCalendarNotifications === 'function') startCalendarNotifications();
  // Route to the correct view now that auth is resolved
  routeFromHash();
  _updateNowPlayingContext();
}

async function authLogout() {
  if (_authToken) {
    // Push latest settings before logging out
    await syncToServer(true).catch((e) => { /* fire-and-forget */ });
    apiPost('/api/auth/logout', {}).catch((e) => { /* fire-and-forget */ });
  }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  // Clear all user-specific data from localStorage
  for (const key of SYNC_KEYS) localStorage.removeItem(key);
  localStorage.removeItem('authToken');
  window.electronAPI?.deleteAuthToken?.();
  localStorage.removeItem('authUser');
  localStorage.removeItem('authUserInfo');
  _updateAccountUI();
  _stopSyncInterval();
  window.location.href = '/login.html';
}

function _updateAccountUI() {
  const avatarSpan = document.getElementById('sb-dashboard-avatar');
  const avatarIcon = document.getElementById('sb-dashboard-icon');
  if (!avatarSpan) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _updateAccountUI, { once: true });
    }
    return;
  }
  if (_guestMode) {
    if (typeof AetherUI !== 'undefined') {
      AetherUI.mount(
        new View('span')
          .style('width', '22px').style('height', '22px').style('border-radius', '50%')
          .style('background', 'var(--nr-bg-tertiary)').style('display', 'flex')
          .style('align-items', 'center').style('justify-content', 'center')
          .style('font-size', '13px').style('animation', 'nr-breathe 3s ease-in-out infinite')
          ._bindText('\uD83D\uDC7B'),
        avatarSpan
      );
    }
    avatarSpan.style.display = '';
    if (avatarIcon) avatarIcon.style.display = 'none';
    return;
  }
  if (_authUserInfo && (_authUserInfo.username || _authUserInfo.name)) {
    if (typeof AetherUI === 'undefined') {
      avatarSpan.style.display = '';
      if (avatarIcon) avatarIcon.style.display = 'none';
      return;
    }
    if (_authUserInfo.picture) {
      AetherUI.mount(
        Image(_authUserInfo.picture)
          .style('width', '22px').style('height', '22px').style('object-fit', 'cover')
          .style('border-radius', '50%').style('display', 'block')
          .attr('referrerpolicy', 'no-referrer'),
        avatarSpan
      );
    } else {
      const letter = (_authUserInfo.username || _authUserInfo.name || '?')[0].toUpperCase();
      AetherUI.mount(
        new View('span')
          .style('width', '22px').style('height', '22px').style('border-radius', '50%')
          .style('background', 'var(--nr-accent)').style('display', 'flex')
          .style('align-items', 'center').style('justify-content', 'center')
          .style('font-size', '11px').style('font-weight', '600').style('color', '#fff')
          ._bindText(letter),
        avatarSpan
      );
    }
    avatarSpan.style.display = '';
    if (avatarIcon) avatarIcon.style.display = 'none';
  } else {
    avatarSpan.style.display = 'none';
    if (avatarIcon) avatarIcon.style.display = '';
  }
}


// ── Sync ──

function _buildSyncPayload(keysToSync) {
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

function _applySyncData(serverData) {
  for (const [key, entry] of Object.entries(serverData)) {
    if (!_syncKeysSet.has(key)) continue;
    const value = entry.value;
    if (value === null || value === undefined) continue;
    // Temporarily remove from dirty set — this write is from server, not user
    _syncDirtyKeys.delete(key);
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    _syncDirtyKeys.delete(key);
  }
}

async function syncToServer(force) {
  if (!_authToken) return;
  const keysToSync = force ? SYNC_KEYS : [..._syncDirtyKeys];
  if (!keysToSync.length) return; // nothing changed
  _syncDirtyKeys.clear();
  try {
    const result = await apiPost('/api/sync', { data: _buildSyncPayload(keysToSync) });
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] push failed:', e);
    // Re-mark as dirty so they retry next cycle
    for (const k of keysToSync) _syncDirtyKeys.add(k);
  }
}

async function syncFromServer() {
  if (!_authToken) return;
  try {
    // Pull only — send empty payload so server data always wins
    const result = await apiPost('/api/sync', { data: {} });
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] pull failed:', e);
  }
}

function _startSyncInterval() {
  _stopSyncInterval();
  _syncInterval = setInterval(syncToServer, 60000);
}

function _stopSyncInterval() {
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
}

// ── UI action handlers ──

function _doLogout() {
  authLogout();
}

async function _doDeleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  if (!confirm('All your data will be permanently deleted. Continue?')) return;
  try {
    await apiPost('/api/auth/delete-account', {});
  } catch (e) { /* proceed with local cleanup regardless */ }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  localStorage.clear();
  window.electronAPI?.deleteAuthToken?.();
  _updateAccountUI();
  _stopSyncInterval();
  window.location.href = '/login.html';
}

// ── Guest mode ──

const _GUEST_STASH_PREFIX = '_guestStash_';

function enterGuestMode() {
  if (_guestMode) return;
  // Stash auth state
  sessionStorage.setItem(_GUEST_STASH_PREFIX + 'authToken', _authToken || '');
  sessionStorage.setItem(_GUEST_STASH_PREFIX + 'authUser', _authUser || '');
  sessionStorage.setItem(_GUEST_STASH_PREFIX + 'authUserInfo', JSON.stringify(_authUserInfo));
  // Stash all sync keys
  for (let i = 0; i < SYNC_KEYS.length; i++) {
    const val = localStorage.getItem(SYNC_KEYS[i]);
    if (val !== null) sessionStorage.setItem(_GUEST_STASH_PREFIX + SYNC_KEYS[i], val);
  }
  // Clear auth state
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _stopSyncInterval();
  // Set guest mode flag
  _guestMode = true;
  sessionStorage.setItem('_guestMode', 'true');
  _updateAccountUI();
  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Guest mode active');
}

function exitGuestMode() {
  if (!_guestMode) return;
  // Restore auth state
  _authToken = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authToken') || null;
  _authUser = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authUser') || null;
  const uiRaw = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authUserInfo');
  _authUserInfo = uiRaw ? JSON.parse(uiRaw) : null;
  if (_authToken) localStorage.setItem('authToken', _authToken);
  if (_authUser) localStorage.setItem('authUser', _authUser);
  if (_authUserInfo) localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
  // Restore sync keys
  for (let i = 0; i < SYNC_KEYS.length; i++) {
    const val = sessionStorage.getItem(_GUEST_STASH_PREFIX + SYNC_KEYS[i]);
    if (val !== null) localStorage.setItem(SYNC_KEYS[i], val);
  }
  // Clear stash
  const keys = [];
  for (let j = 0; j < sessionStorage.length; j++) keys.push(sessionStorage.key(j));
  for (let k = 0; k < keys.length; k++) {
    if (keys[k].indexOf(_GUEST_STASH_PREFIX) === 0) sessionStorage.removeItem(keys[k]);
  }
  // Clear guest flag
  _guestMode = false;
  sessionStorage.removeItem('_guestMode');
  _onLoginSuccess();
  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Welcome back, ' + (_authUser || 'User'));
}

// ── User menu popover ──

function _toggleUserMenu() {
  const pop = document.getElementById('user-menu-popover');
  if (!pop) return;
  const visible = pop.style.display !== 'none';
  pop.style.display = visible ? 'none' : '';
  if (!visible) {
    _updateUserMenuLabels();
    // Close on outside click
    setTimeout(function() {
      document.addEventListener('click', _closeUserMenuOutside, { once: true });
    }, 0);
  }
}

function _closeUserMenuOutside(e) {
  const pop = document.getElementById('user-menu-popover');
  const wrap = document.getElementById('sb-dashboard-wrap');
  if (pop && wrap && !wrap.contains(e.target)) pop.style.display = 'none';
}

function _updateUserMenuLabels() {
  const label = document.getElementById('user-menu-guest-label');
  if (!label) return;
  if (_guestMode) {
    const name = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authUser') || 'Account';
    label.textContent = 'Return to ' + name;
  } else {
    label.textContent = 'Guest Mode';
  }
}

function _userMenuGuestAction() {
  if (_guestMode) {
    exitGuestMode();
  } else {
    enterGuestMode();
  }
}

// ── Initialize: check session, redirect to login if needed ──
(function _initAuth() {
  _updateAccountUI();
  if (_guestMode) {
    _authReady = true;
    routeFromHash();
    return;
  }
  if (_authToken) {
    // Verify session is still valid
    apiGet('/api/auth/me')
      .then(data => {
        _authUser = (data.name || data.email || _authUser || '').split(' ')[0];
        _authUserInfo = { email: data.email, name: data.name, google_id: data.google_id, username: data.username || null, picture: data.picture || null };
        localStorage.setItem('authUser', _authUser);
        localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
        if (!data.username) {
          // No username set — redirect to onboarding
          window.location.href = '/onboarding.html';
          return;
        }
        _onLoginSuccess();
        syncFromServer();
      })
      .catch(() => {
        _authToken = null;
        _authUser = null;
        _authUserInfo = null;
        localStorage.removeItem('authToken');
        window.electronAPI?.deleteAuthToken?.();
        localStorage.removeItem('authUser');
        localStorage.removeItem('authUserInfo');
        _updateAccountUI();
        window.location.href = '/login.html';
      });
  } else {
    // No token — redirect to login
    window.location.href = '/login.html';
  }
})();

