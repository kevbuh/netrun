function applyStoredAppearance() {
  const theme = localStorage.getItem('theme') || 'clear';
  const resolved = theme === 'auto' ? _resolveAutoTheme() : theme;
  if (resolved !== 'dark') document.documentElement.setAttribute('data-theme', resolved);
  else document.documentElement.removeAttribute('data-theme');
  if (resolved === 'daylight') startDaylightTheme();
  const accent = localStorage.getItem('accentColor');
  if (accent) applyAccentColor(accent);
  const edTheme = localStorage.getItem('editorTheme');
  if (edTheme && edTheme !== 'auto') document.documentElement.setAttribute('data-editor-theme', edTheme);
  const aether = localStorage.getItem('aetherColor') || 'match';
  const aetherMode = aether.startsWith('#') ? 'midnight' : aether;
  document.documentElement.setAttribute('data-aether-theme', aetherMode);
  const iconSize = localStorage.getItem('iconSize') || 'medium';
  document.documentElement.setAttribute('data-icon-size', iconSize);
}

applyStoredAppearance();
