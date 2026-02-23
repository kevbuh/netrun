// browse-doom-scroll.js — Doom scroll prevention & focus timer
// Extracted from browse-downloads.js
import Settings from '/js/core/core-settings.js';

// ── Doom Scroll Prevention ──
export const _DOOM_SCROLL_DEFAULTS = [
  { domain: 'twitter.com', mode: 'nudge', minutes: 5 },
  { domain: 'x.com', mode: 'nudge', minutes: 5 },
  { domain: 'reddit.com', mode: 'nudge', minutes: 5 },
  { domain: 'tiktok.com', mode: 'block', minutes: 0 },
  { domain: 'instagram.com', mode: 'nudge', minutes: 10 },
  { domain: 'facebook.com', mode: 'nudge', minutes: 10 },
];

export function _getDoomScrollSites() {
  try {
    const saved = Settings.get('doomScrollSites');
    if (saved) return JSON.parse(saved);
  } catch {}
  return _DOOM_SCROLL_DEFAULTS.slice();
}

export function _saveDoomScrollSites(list) {
  Settings.setJSON('doomScrollSites', list);
}

export function _doomScrollMatch(url) {
  if (Settings.get('doomScrollEnabled') === 'false') return null;
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const sites = _getDoomScrollSites();
  for (const site of sites) {
    const d = site.domain.toLowerCase();
    if (hostname === d || hostname.endsWith('.' + d)) return site;
  }
  return null;
}

// ── Focus Timer & Block Page — re-exported from browse-downloads (reactive implementations) ──
export {
  _focusTimerStarts,
  _focusTimerInterval,
  _focusTimerDomain,
  _focusTimerWarnMinutes,
  _persistFocusTimerStarts,
  _formatFocusTime,
  _focusTimerElapsed,
  _startFocusTimer,
  _hideFocusTimerPill,
  _updateFocusTimerPill,
  _checkFocusTimer,
  _doomScrollBypass,
  _browseShowBlockedPage,
  _injectDoomScrollNudge,
} from '/js/browse/browse-downloads.js';
