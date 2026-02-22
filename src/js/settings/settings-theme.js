import Settings from '../core/core-settings.js';
import { apiPut } from '/js/api.js';
import { renderSettingsView } from '/js/settings/settings-core.js';
import { setAetherColor, startDaylightTheme, stopDaylightTheme } from '/js/settings/settings-colors.js';

// Map each theme to its underlying color scheme (dark or light)
export const THEME_COLOR_SCHEME = {
  dark: 'dark',
  light: 'light',
  daylight: 'light',
  clear: 'dark',
};

export function _systemColorScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Resolve 'auto' to the actual theme name based on system preference
export function _resolveAutoTheme() {
  return _systemColorScheme() === 'dark' ? 'dark' : 'light';
}

// Apply the resolved theme to the DOM (shared by setTheme and the system listener)
export function _applyResolvedTheme(resolved) {
  stopDaylightTheme();
  if (resolved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else if (resolved === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', resolved);
  }
  if (resolved === 'daylight') startDaylightTheme();
}

// Listen for system color scheme changes to update 'auto' theme in real time
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((Settings.get('theme') || 'light') === 'auto') {
    _applyResolvedTheme(_resolveAutoTheme());
  }
});

export function setTheme(theme) {
  Settings.set('theme', theme);
  const resolved = theme === 'auto' ? _resolveAutoTheme() : theme;
  _applyResolvedTheme(resolved);
  // Clear theme requires match aether theme for readable text
  if (resolved === 'clear' && typeof setAetherColor === 'function') {
    setAetherColor('match');
  }
  ['auto', 'dark', 'light', 'daylight', 'clear'].forEach(t => {
    const btn = document.getElementById('theme-btn-' + t);
    if (btn) btn.className = `px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}`;
  });
}

export async function toggleProfilePrivacy(on) {
  try {
    await apiPut('/api/users/me/privacy', { profile_private: on });
    if (window._authUserInfo) {
      window._authUserInfo.profile_private = on;
    }
  } catch (err) { /* ignore */ }
}

export function resetAdBlockRules() {
  const el = document.getElementById('adblock-rules-info');
  if (!window.electronAPI || !window.electronAPI.adblockUpdate) {
    if (el) el.textContent = 'Filter list updates require Electron.';
    return;
  }
  if (el) el.textContent = 'Updating filter lists...';
  window.electronAPI.adblockUpdate()
    .then(stats => {
      if (!el) return;
      if (stats.lists && stats.lists.length > 0) {
        const count = (stats.ruleCount || 0).toLocaleString();
        el.textContent = `${stats.lists.join(' + ')}: ${count} rules loaded.`;
      } else {
        el.textContent = 'Failed to download filter lists.';
      }
    }).catch(() => { if (el) el.textContent = 'Error updating filter lists.'; });
}

export function setEditorTheme(theme) {
  Settings.set('editorTheme', theme);
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-editor-theme');
  } else {
    document.documentElement.setAttribute('data-editor-theme', theme);
  }
  ['auto','monokai','dracula','solarized','github','nord'].forEach(t => {
    const btn = document.getElementById('editor-theme-btn-' + t);
    if (btn) btn.className = 'px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ' + (theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary');
  });
}

export function setIconSize(size) {
  Settings.set('iconSize', size);
  document.documentElement.setAttribute('data-icon-size', size);
  renderSettingsView();
}

