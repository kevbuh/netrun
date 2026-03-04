import Settings from '../core/core-settings.js';
import { getSelectedSpinner, setSelectedSpinner } from '/js/core/core-layout.js';
import { renderSettingsView } from '/js/settings/settings-core.js';

// @signal — tracks the active accent color for reactive swatch highlighting
export var _accentColorState = State(Settings.get('accentColor') || '#b4451a');

export function setAccentColor(color) {
  Settings.set('accentColor', color);
  applyAccentColor(color);
  _accentColorState.value = color;
}

export let _spinnerPreviewInterval = null;
export function clearSpinnerPreview() { if (_spinnerPreviewInterval) { clearInterval(_spinnerPreviewInterval); _spinnerPreviewInterval = null; } }

export function cycleSpinner(dir) {
  if (!window._spinnerData || !window._spinnerNames.length) return;
  const current = getSelectedSpinner();
  let idx = window._spinnerNames.indexOf(current);
  if (idx === -1) idx = 0;
  idx = (idx + dir + window._spinnerNames.length) % window._spinnerNames.length;
  const name = window._spinnerNames[idx];
  setSelectedSpinner(name);
  updateSpinnerPreview(name);
}

export function updateSpinnerPreview(name) {
  const el = document.getElementById('spinner-preview');
  const nameEl = document.getElementById('spinner-name');
  if (!el || !window._spinnerData) return;
  if (nameEl) nameEl.textContent = name;
  const spinner = window._spinnerData[name];
  if (!spinner) return;
  if (_spinnerPreviewInterval) clearInterval(_spinnerPreviewInterval);
  let i = 0;
  el.textContent = spinner.frames[0];
  _spinnerPreviewInterval = setInterval(() => {
    i = (i + 1) % spinner.frames.length;
    el.textContent = spinner.frames[i];
  }, spinner.interval);
}

export function applyAccentColor(color) {
  // Compute a lighter hover variant
  const r = parseInt(color.slice(1,3), 16), g = parseInt(color.slice(3,5), 16), b = parseInt(color.slice(5,7), 16);
  const hover = '#' + [Math.min(255, r + 20), Math.min(255, g + 20), Math.min(255, b + 20)].map(v => v.toString(16).padStart(2, '0')).join('');
  document.documentElement.style.setProperty('--nr-accent', color);
  document.documentElement.style.setProperty('--nr-accent-hover', hover);
}

export function setAetherColor(mode) {
  Settings.set('aetherColor', mode);
  document.documentElement.setAttribute('data-aether-theme', mode);
  renderSettingsView();
}

