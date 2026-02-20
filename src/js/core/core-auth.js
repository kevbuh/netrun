// core-auth.js — Auth system, sync
// Extracted from core.js

import Settings from '/js/core/core-settings.js';
import { apiPost, apiGet } from '/js/api.js';
import { routeFromHash } from '/js/core/core-routing.js';
import { _loadCustomAnnotationCategories } from '/js/core/core-ui.js';
import { _updateNowPlayingContext } from '/js/core/core-audio.js';
import { applyStoredAppearance } from '/js/settings/settings-init.js';
import { renderSettingsView } from '/js/settings/settings-core.js';
import { logger } from '/js/logger.js';

// ── User accounts & sync ──

// Clean up broken token (object was stored as "[object Object]" due to prior bug)
if (window._authToken === '[object Object]') {
  window._authToken = null;
  localStorage.removeItem('authToken');
}
// Hydrate token from secure storage (macOS Keychain) if available
if (!window._authToken && window.electronAPI?.getAuthToken) {
  window.electronAPI.getAuthToken().then(t => {
    if (t && t !== '[object Object]' && !window._authToken) { window._authToken = t; localStorage.setItem('authToken', t); }
  });
}
let _authUser = localStorage.getItem('authUser') || null;  // email or name
let _syncInterval = null;
let _authReady = false;  // true once login gate has been resolved
Object.defineProperty(window, '_authReady', {
  get() { return _authReady; },
  set(v) { _authReady = v; }
});

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
const SYNC_KEYS = Settings.getSyncKeys();
SYNC_KEYS.forEach(k => _syncKeysSet.add(k));

// Default ad blocker to enabled
if (Settings.get('adBlockEnabled') === null) {
  Settings.set('adBlockEnabled', 'true');
}

// Default encrypted DNS to enabled
if (Settings.get('dohEnabled') === null) Settings.set('dohEnabled', 'true');
if (Settings.get('dohProvider') === null) Settings.set('dohProvider', 'cloudflare');

// ── localStorage helpers (reduce try/parse/default boilerplate) ──
export function getLS(key, fallback) {
  return Settings.getJSON(key, fallback);
}
export function setLS(key, val) { Settings.setJSON(key, val); }

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
  if (typeof _loadCustomAnnotationCategories === 'function') _loadCustomAnnotationCategories();
  // Calendar event notifications
  if (typeof startCalendarNotifications === 'function') startCalendarNotifications();
  // Route to the correct view now that auth is resolved
  routeFromHash();
  _updateNowPlayingContext();
}

export async function authLogout() {
  if (window._authToken) {
    // Push latest settings before logging out
    await syncToServer(true).catch((e) => { /* fire-and-forget */ });
    apiPost('/api/auth/logout', {}).catch((e) => { /* fire-and-forget */ });
  }
  window._authToken = null;
  _authUser = null;
  window._authUserInfo = null;
  _authReady = false;
  // Clear all user-specific data from localStorage
  for (const key of SYNC_KEYS) Settings.remove(key);
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
  const avatarMode = window._guestMode ? 'guest'
    : (window._authUserInfo && (window._authUserInfo.username || window._authUserInfo.name)) ? 'user'
    : 'none';

  if (avatarMode === 'none') {
    avatarSpan.style.display = 'none';
    if (avatarIcon) avatarIcon.style.display = '';
    return;
  }

  avatarSpan.style.display = '';
  if (avatarIcon) avatarIcon.style.display = 'none';

  if (typeof AetherUI === 'undefined') return;

  AetherUI.mount(window.Switch(avatarMode, {
    guest: function() {
      return window.RawHTML('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:nr-breathe 3s ease-in-out infinite"><path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></svg>');
    },
    user: function() {
      return window.Show(window._authUserInfo && window._authUserInfo.picture, function() {
        return window.Image(window._authUserInfo.picture)
          .styles({width:'22px', height:'22px', objectFit:'cover', borderRadius:'50%', display:'block'})
          .attr('referrerpolicy', 'no-referrer');
      }, function() {
        const letter = (window._authUserInfo.username || window._authUserInfo.name || '?')[0].toUpperCase();
        return new window.View('span')
          .styles({width:'22px', height:'22px', borderRadius:'50%', background:'var(--nr-accent)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'11px', fontWeight:'600', color:'#fff'})
          ._bindText(letter);
      });
    },
  }), avatarSpan);
}

// ── Sync ──

function _buildSyncPayload(keysToSync) {
  const data = {};
  const now = Date.now() / 1000;
  for (const key of keysToSync) {
    const raw = Settings.get(key);
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
    Settings.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    _syncDirtyKeys.delete(key);
  }
}

export async function syncToServer(force) {
  if (!window._authToken) return;
  const keysToSync = force ? SYNC_KEYS : [..._syncDirtyKeys];
  if (!keysToSync.length) return; // nothing changed
  _syncDirtyKeys.clear();
  try {
    const result = await apiPost('/api/sync', { data: _buildSyncPayload(keysToSync) });
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    logger.warn('[sync] push failed:', e);
    // Re-mark as dirty so they retry next cycle
    for (const k of keysToSync) _syncDirtyKeys.add(k);
  }
}

export async function syncFromServer() {
  if (!window._authToken) return;
  try {
    // Pull only — send empty payload so server data always wins
    const result = await apiPost('/api/sync', { data: {} });
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    logger.warn('[sync] pull failed:', e);
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

export function _doLogout() {
  authLogout();
}

export async function _doDeleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  if (!confirm('All your data will be permanently deleted. Continue?')) return;
  try {
    await apiPost('/api/auth/delete-account', {});
  } catch (e) { /* proceed with local cleanup regardless */ }
  window._authToken = null;
  _authUser = null;
  window._authUserInfo = null;
  _authReady = false;
  localStorage.clear();
  window.electronAPI?.deleteAuthToken?.();
  _updateAccountUI();
  _stopSyncInterval();
  window.location.href = '/login.html';
}

// ── Guest mode ──

const _GUEST_STASH_PREFIX = '_guestStash_';

export function enterGuestMode() {
  if (window._guestMode) return;
  // Stash auth state
  sessionStorage.setItem(_GUEST_STASH_PREFIX + 'authToken', window._authToken || '');
  sessionStorage.setItem(_GUEST_STASH_PREFIX + 'authUser', _authUser || '');
  sessionStorage.setItem(_GUEST_STASH_PREFIX + 'authUserInfo', JSON.stringify(window._authUserInfo));
  // Stash all sync keys
  for (let i = 0; i < SYNC_KEYS.length; i++) {
    const val = Settings.get(SYNC_KEYS[i]);
    if (val !== null) sessionStorage.setItem(_GUEST_STASH_PREFIX + SYNC_KEYS[i], val);
  }
  // Clear auth state
  window._authToken = null;
  _authUser = null;
  window._authUserInfo = null;
  _stopSyncInterval();
  // Stash Google session cookies so the guest isn't signed into Google in the browser
  if (window.electronAPI?.stashGoogleCookies) window.electronAPI.stashGoogleCookies();
  // Set guest mode flag
  window._guestMode = true;
  sessionStorage.setItem('window._guestMode', 'true');
  _updateAccountUI();
  if (typeof renderSettingsView === 'function') renderSettingsView();
  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Guest mode active');
}

export function exitGuestMode() {
  if (!window._guestMode) return;
  // Restore auth state
  window._authToken = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authToken') || null;
  _authUser = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authUser') || null;
  const uiRaw = sessionStorage.getItem(_GUEST_STASH_PREFIX + 'authUserInfo');
  window._authUserInfo = uiRaw ? JSON.parse(uiRaw) : null;
  if (window._authToken) localStorage.setItem('authToken', window._authToken);
  if (_authUser) localStorage.setItem('authUser', _authUser);
  if (window._authUserInfo) localStorage.setItem('authUserInfo', JSON.stringify(window._authUserInfo));
  // Restore sync keys
  for (let i = 0; i < SYNC_KEYS.length; i++) {
    const val = sessionStorage.getItem(_GUEST_STASH_PREFIX + SYNC_KEYS[i]);
    if (val !== null) Settings.set(SYNC_KEYS[i], val);
  }
  // Clear stash
  const keys = [];
  for (let j = 0; j < sessionStorage.length; j++) keys.push(sessionStorage.key(j));
  for (let k = 0; k < keys.length; k++) {
    if (keys[k].indexOf(_GUEST_STASH_PREFIX) === 0) sessionStorage.removeItem(keys[k]);
  }
  // Clear guest flag
  window._guestMode = false;
  sessionStorage.removeItem('window._guestMode');
  // Restore Google cookies
  if (window.electronAPI?.restoreGoogleCookies) window.electronAPI.restoreGoogleCookies();
  _onLoginSuccess();
  if (typeof renderSettingsView === 'function') renderSettingsView();
  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Welcome back, ' + (_authUser || 'User'));
}

// ── Initialize: check session, redirect to login if needed ──
(function _initAuth() {
  Settings.init();
  _updateAccountUI();
  if (window._guestMode) {
    _authReady = true;
    routeFromHash();
    return;
  }
  if (window._authToken) {
    // Verify session is still valid
    apiGet('/api/auth/me')
      .then(data => {
        if (!data || !data.email) throw new Error('Invalid session');
        _authUser = (data.name || data.email || _authUser || '').split(' ')[0];
        window._authUserInfo = { email: data.email, name: data.name, google_id: data.google_id, username: data.username || null, picture: data.picture || null };
        localStorage.setItem('authUser', _authUser);
        localStorage.setItem('authUserInfo', JSON.stringify(window._authUserInfo));
        if (!data.username) {
          // No username set — redirect to onboarding
          window.location.href = '/onboarding.html';
          return;
        }
        _onLoginSuccess();
        syncFromServer();
      })
      .catch(err => {
        logger.warn('[auth] Session verify failed:', err);
        // If we have cached auth info locally, proceed offline rather than forcing re-login
        if (window._authUserInfo && window._authUserInfo.google_id && window._authUserInfo.username) {
          logger.debug('[auth] Using cached auth info');
          _authUser = (window._authUserInfo.name || window._authUserInfo.email || _authUser || '').split(' ')[0];
          _onLoginSuccess();
          return;
        }
        window._authToken = null;
        _authUser = null;
        window._authUserInfo = null;
        localStorage.removeItem('authToken');
        window.electronAPI?.deleteAuthToken?.();
        localStorage.removeItem('authUser');
        localStorage.removeItem('authUserInfo');
        _updateAccountUI();
        window.location.href = '/login.html';
      });
  } else {
    // No token — try hydrating from secure storage before redirecting
    if (window.electronAPI?.getAuthToken) {
      window.electronAPI.getAuthToken().then(t => {
        if (t) {
          window._authToken = t;
          localStorage.setItem('authToken', t);
          // Re-run auth check with hydrated token
          _initAuth();
        } else if (window._authUserInfo && window._authUserInfo.google_id && window._authUserInfo.username) {
          // Have cached auth info but no token — proceed offline
          logger.debug('[auth] No token but have cached auth info, proceeding');
          window._authToken = 'cached';
          _authUser = (window._authUserInfo.name || window._authUserInfo.email || '').split(' ')[0];
          _onLoginSuccess();
        } else {
          window.location.href = '/login.html';
        }
      }).catch(() => {
        window.location.href = '/login.html';
      });
    } else {
      window.location.href = '/login.html';
    }
  }
})();

// _showLoginGate must stay on window — api.js uses typeof guard, login page defines its own
window._showLoginGate = _showLoginGate;

