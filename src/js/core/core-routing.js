// core-routing.js — Route table
// Extracted from core.js
import Settings from '/js/core/core-settings.js';
import { _navPush } from '/js/core/core-nav.js';
import { _updateNowPlayingContext } from '/js/core/core-audio.js';
import { openUserProfile } from '/js/core/core-profile.js';
import { openResearch, wmOpen } from '/js/core/core-views.js';
import { _settingsFeedTab, _settingsSection } from '/js/settings/settings-core.js';
import { openAllSaved } from '/js/dashboard.js';

// ── Route table — exact hash → action ──
const _ROUTE_TABLE = {
  '#research':    () => { openResearch(); },
  '#settings':    () => wmOpen('settings'),
  '#quality':     () => { _settingsSection = 'feed'; _settingsFeedTab = 'quality'; Settings.set('settingsSection', 'feed'); wmOpen('settings'); },
  '#algorithm':   () => { _settingsSection = 'feed'; _settingsFeedTab = 'algorithm'; Settings.set('settingsSection', 'feed'); wmOpen('settings'); },
  '#calendar':    () => wmOpen('dashboard'),
  '#inbox':       () => wmOpen('inbox'),
  '#profile':     () => openUserProfile(''),
  '#saved-all':   () => openAllSaved(),
  '#saved':       () => wmOpen('dashboard'),
  '#browse':      () => wmOpen('browse'),
  '#search':      () => { openResearch('search'); },
  '#terminal':    () => { openTerminal(); },
  '#neuralook':   () => wmOpen('neuralook'),
  '#dev':         () => wmOpen('dev'),
  '#vibe':        () => wmOpen('dashboard'),
  '#feed':        () => wmOpen('feed'),
};

// ── Prefix route handlers — hash prefix → handler(remainder) ──
const _ROUTE_PREFIX_HANDLERS = [
  ['#profile/',    (rest) => openUserProfile(decodeURIComponent(rest))],
];

export function routeFromHash() {
  const hash = window.location.hash;
  const _oldHash = window._currentRouteHash || '';
  window._currentRouteHash = hash;
  window._prevRouteHash = _oldHash;
  _navPush(hash);

  // Exact match
  const exactHandler = _ROUTE_TABLE[hash];
  if (exactHandler) { exactHandler(); return; }

  // Prefix match
  for (let i = 0; i < _ROUTE_PREFIX_HANDLERS.length; i++) {
    const [prefix, handler] = _ROUTE_PREFIX_HANDLERS[i];
    if (hash.startsWith(prefix)) { handler(hash.slice(prefix.length)); return; }
  }

  // Default
  wmOpen('dashboard');
}

// Save hash to localStorage for "remember where we left off"
window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash && hash !== '#') {
    Settings.set('lastHash', hash);
  }
  routeFromHash();
  _updateNowPlayingContext();
});

// On page load, restore last hash if no hash specified
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.hash || window.location.hash === '#') {
      const lastHash = Settings.get('lastHash');
      if (lastHash) {
        window.location.hash = lastHash;
        return;
      }
    }
    routeFromHash();
    _updateNowPlayingContext();
  });
} else {
  setTimeout(() => {
    if (!window.location.hash || window.location.hash === '#') {
      const lastHash = Settings.get('lastHash');
      if (lastHash) {
        window.location.hash = lastHash;
        return;
      }
    }
    routeFromHash();
    _updateNowPlayingContext();
  }, 0);
}

// ── User Profile ──