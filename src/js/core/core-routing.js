// core-routing.js — Route table
// Extracted from core.js

// ── Route table — exact hash → action ──
var _ROUTE_TABLE = {
  '#research':    () => { openResearch(); },
  '#experiments': () => wmOpen('vault'),
  '#settings':    () => wmOpen('settings'),
  '#quality':     () => { _settingsSection = 'feed'; _settingsFeedTab = 'quality'; sessionStorage.setItem('settingsSection', 'feed'); wmOpen('settings'); },
  '#algorithm':   () => { _settingsSection = 'feed'; _settingsFeedTab = 'algorithm'; sessionStorage.setItem('settingsSection', 'feed'); wmOpen('settings'); },
  '#calendar':    () => wmOpen('dashboard'),
  '#inbox':       () => wmOpen('inbox'),
  '#teams':       () => openTeams(),
  '#vault':       () => wmOpen('vault'),
  '#profile':     () => openUserProfile(''),
  '#saved-all':   () => openAllSaved(),
  '#saved':       () => wmOpen('dashboard'),
  '#browse':      () => wmOpen('browse'),
  '#search':      () => { openResearch('search'); },
  '#terminal':    () => { openTerminal(); },
  '#neuralook':   () => wmOpen('neuralook'),
  '#dev':         () => wmOpen('dev'),
  '#graph':       () => wmOpen('graph'),
  '#vibe':        () => wmOpen('vault'),
  '#feed':        () => wmOpen('feed'),
};

// ── Prefix route handlers — hash prefix → handler(remainder) ──
var _ROUTE_PREFIX_HANDLERS = [
  ['#blog/',       (rest) => { const parts = rest.split('/'); if (parts.length >= 2) { const username = decodeURIComponent(parts[0]); const slug = decodeURIComponent(parts.slice(1).join('/')); if (typeof openBlogPost === 'function') openBlogPost(username, slug); } }],
  ['#team/',       (rest) => { const teamId = parseInt(rest, 10); if (teamId && typeof showTeamDetailView === 'function') showTeamDetailView(teamId); }],
  ['#profile/',    (rest) => openUserProfile(decodeURIComponent(rest))],
  ['#experiment/', (rest) => { const qIdx = rest.indexOf('?'); const expId = qIdx >= 0 ? decodeURIComponent(rest.slice(0, qIdx)) : decodeURIComponent(rest); const params = qIdx >= 0 ? new URLSearchParams(rest.slice(qIdx)) : null; const autoFile = params && params.get('file'); wmOpen('vault'); setTimeout(() => { if (typeof vaultExpandProject === 'function') vaultExpandProject(expId); if (autoFile && typeof vaultOpenProjectFile === 'function') vaultOpenProjectFile(expId, decodeURIComponent(autoFile)); }, 300); }],
];

function routeFromHash() {
  const hash = window.location.hash;
  const _oldHash = _currentRouteHash || '';
  _currentRouteHash = hash;
  _prevRouteHash = _oldHash;
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
    localStorage.setItem('lastHash', hash);
  }
  routeFromHash();
  _updateNowPlayingContext();
});

// On page load, restore last hash if no hash specified
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.hash || window.location.hash === '#') {
      const lastHash = localStorage.getItem('lastHash');
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
      const lastHash = localStorage.getItem('lastHash');
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