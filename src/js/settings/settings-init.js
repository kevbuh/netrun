import Settings from '../core/core-settings.js';

export function applyStoredAppearance() {
  const theme = Settings.get('theme') || 'clear';
  const resolved = theme === 'auto' ? _resolveAutoTheme() : theme;
  if (resolved !== 'dark') document.documentElement.setAttribute('data-theme', resolved);
  else document.documentElement.removeAttribute('data-theme');
  if (resolved === 'daylight') startDaylightTheme();
  const accent = Settings.get('accentColor');
  if (accent) applyAccentColor(accent);
  const edTheme = Settings.get('editorTheme');
  if (edTheme && edTheme !== 'auto') document.documentElement.setAttribute('data-editor-theme', edTheme);
  const aether = Settings.get('aetherColor') || 'match';
  const aetherMode = aether.startsWith('#') ? 'midnight' : aether;
  document.documentElement.setAttribute('data-aether-theme', aetherMode);
  const iconSize = Settings.get('iconSize') || 'medium';
  document.documentElement.setAttribute('data-icon-size', iconSize);
}

applyStoredAppearance();

window.applyStoredAppearance = applyStoredAppearance;
