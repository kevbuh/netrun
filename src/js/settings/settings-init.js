import Settings from '../core/core-settings.js';
import { _resolveAutoTheme } from '/js/settings/settings-theme.js';
import { applyAccentColor } from '/js/settings/settings-colors.js';

export function applyStoredAppearance() {
  let theme = Settings.get('theme') || 'clear';
  if (theme === 'daylight') { theme = 'light'; Settings.set('theme', 'light'); }
  const resolved = theme === 'auto' ? _resolveAutoTheme() : theme;
  if (resolved !== 'dark') document.documentElement.setAttribute('data-theme', resolved);
  else document.documentElement.removeAttribute('data-theme');
  const accent = Settings.get('accentColor');
  if (accent) applyAccentColor(accent);
  const aether = Settings.get('aetherColor') || 'match';
  const aetherMode = aether.startsWith('#') ? 'midnight' : aether;
  document.documentElement.setAttribute('data-aether-theme', aetherMode);
}

applyStoredAppearance();

