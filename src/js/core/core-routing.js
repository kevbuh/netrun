// core-routing.js — Route table
// Extracted from core.js
import Settings from '/js/core/core-settings.js';
import { _navPush } from '/js/core/core-nav.js';
import { _updateNowPlayingContext } from '/js/core/core-audio.js';
import { openUserProfile } from '/js/core/core-profile.js';
import { openResearch, wmOpen } from '/js/core/core-views.js';
import { _settingsFeedTab, _settingsSection } from '/js/settings/settings-core.js';
import { openNetrunPage } from '/js/netrun-page.js';
import { openTerminalPage } from '/js/terminal.js';

// ── Route table — exact hash → action ──
const _ROUTE_TABLE = {
  '#research':    () => { openResearch(); },
  '#settings':    () => wmOpen('settings'),
  '#quality':     () => { _settingsSection.value = 'feed'; _settingsFeedTab.value = 0; Settings.set('settingsSection', 'feed'); wmOpen('settings'); },
  '#algorithm':   () => { _settingsSection.value = 'feed'; _settingsFeedTab.value = 1; Settings.set('settingsSection', 'feed'); wmOpen('settings'); },
  '#calendar':    () => wmOpen('browse'),
  '#inbox':       () => wmOpen('inbox'),
  '#profile':     () => openUserProfile(''),
  '#saved-all':   () => { openNetrunPage(); },
  '#saved':       () => { openNetrunPage(); },
  '#browse':      () => wmOpen('browse'),
  '#search':      () => { openResearch('search'); },
  '#terminal':    () => { openTerminalPage(); },
  '#neuralook':   () => wmOpen('neuralook'),
  '#dev':         () => wmOpen('dev'),
  '#docs':        () => wmOpen('docs'),
  '#vibe':        () => wmOpen('browse'),
  '#feed':        () => wmOpen('feed'),
  '#bookmarks':   () => { if (typeof window.openBookmarks === 'function') window.openBookmarks(); },
  '#library':     () => { if (typeof window.openBookmarks === 'function') window.openBookmarks(); },
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

  // Default — open browse with netrun:// hub
  wmOpen('browse');
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