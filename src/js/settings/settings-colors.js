import Settings from '../core/core-settings.js';
import { getSelectedSpinner, setSelectedSpinner } from '/js/core/core-layout.js';
import { renderSettingsView } from '/js/settings/settings-core.js';

/* ── Daylight Theme Engine ── */
export var _daylightInterval = null;
export var _daylightSpeedMultiplier = 1; // set to 1440 in console for fast-forward (1 day = 1 min)

// OKLCH→sRGB conversion
export function _oklchToHex(L, C, H) {
  const hRad = H * Math.PI / 180;
  const a_ = C * Math.cos(hRad), b_ = C * Math.sin(hRad);
  // OKLab → linear sRGB
  const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
  const m_ = L - 0.1055613458 * a_ - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a_ - 1.2914855480 * b_;
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
  // Linear sRGB → gamma sRGB
  const gamma = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  r = Math.round(Math.max(0, Math.min(1, gamma(r))) * 255);
  g = Math.round(Math.max(0, Math.min(1, gamma(g))) * 255);
  b = Math.round(Math.max(0, Math.min(1, gamma(b))) * 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function _lerpOklch(a, b, t) {
  // Lerp L, C linearly; lerp H on shortest arc
  const L = a[0] + (b[0] - a[0]) * t;
  const C = a[1] + (b[1] - a[1]) * t;
  let dH = b[2] - a[2];
  if (dH > 180) dH -= 360; else if (dH < -180) dH += 360;
  const H = (a[2] + dH * t + 360) % 360;
  return [L, C, H];
}

// 6 keyframes: [hour, { cssVar: [L,C,H], ... }]
// Special keys ending in '$a' are rgba alpha values (0-1)
export var _daylightKeyframes = [
  [5, { // Dawn — warm rose-gray
    '--nr-bg-body':          [0.30, 0.02, 30],
    '--nr-text-primary':     [0.85, 0.01, 60],
    '--nr-text-inverse':     [0.92, 0.005, 60],
    '--nr-text-secondary':   [0.65, 0.01, 50],
    '--nr-text-quaternary':  [0.48, 0.01, 40],
    '--nr-bg-raised':        [0.28, 0.02, 30],
    '--nr-bg-surface':       [0.27, 0.02, 30],
    '--nr-bg-input':         [0.24, 0.02, 30],
    '--nr-border-default':   [0.32, 0.015, 30],
    '--nr-border-strong':    [0.38, 0.015, 35],
    '--nr-border-subtle':    [0.30, 0.015, 30],
    '--nr-border-dim':       [0.24, 0.015, 30],
    '--nr-bg-sunken':        [0.28, 0.02, 30],
    '--nr-bg-overlay':       [0.26, 0.02, 30],
    '--nr-text-link':        [0.65, 0.12, 50],
    '--nr-tooltip-bg':       [0.26, 0.02, 30],
    '--nr-tooltip-border':   [0.32, 0.015, 30],
    '--nr-shadow-card$a':    0.25,
    '--nr-shadow-popup$a':   0.40,
    '--nr-shadow-overlay$a': 0.45,
  }],
  [8, { // Morning — warm cream
    '--nr-bg-body':          [0.92, 0.02, 80],
    '--nr-text-primary':     [0.25, 0.02, 50],
    '--nr-text-inverse':     [0.15, 0.02, 50],
    '--nr-text-secondary':   [0.50, 0.02, 55],
    '--nr-text-quaternary':  [0.65, 0.015, 60],
    '--nr-bg-raised':        [0.88, 0.02, 78],
    '--nr-bg-surface':       [0.90, 0.02, 78],
    '--nr-bg-input':         [0.88, 0.02, 78],
    '--nr-border-default':   [0.82, 0.02, 72],
    '--nr-border-strong':    [0.75, 0.02, 68],
    '--nr-border-subtle':    [0.85, 0.02, 75],
    '--nr-border-dim':       [0.88, 0.015, 78],
    '--nr-bg-sunken':        [0.91, 0.02, 79],
    '--nr-bg-overlay':       [0.90, 0.02, 78],
    '--nr-text-link':        [0.50, 0.12, 45],
    '--nr-tooltip-bg':       [0.90, 0.02, 78],
    '--nr-tooltip-border':   [0.82, 0.02, 72],
    '--nr-shadow-card$a':    0.06,
    '--nr-shadow-popup$a':   0.12,
    '--nr-shadow-overlay$a': 0.22,
  }],
  [12, { // Midday — bright neutral
    '--nr-bg-body':          [0.96, 0.005, 250],
    '--nr-text-primary':     [0.20, 0.01, 260],
    '--nr-text-inverse':     [0.12, 0.01, 260],
    '--nr-text-secondary':   [0.48, 0.01, 255],
    '--nr-text-quaternary':  [0.64, 0.006, 255],
    '--nr-bg-raised':        [0.92, 0.005, 250],
    '--nr-bg-surface':       [0.94, 0.005, 250],
    '--nr-bg-input':         [0.92, 0.005, 250],
    '--nr-border-default':   [0.85, 0.005, 250],
    '--nr-border-strong':    [0.78, 0.008, 250],
    '--nr-border-subtle':    [0.88, 0.005, 250],
    '--nr-border-dim':       [0.91, 0.004, 250],
    '--nr-bg-sunken':        [0.95, 0.005, 250],
    '--nr-bg-overlay':       [0.94, 0.005, 250],
    '--nr-text-link':        [0.52, 0.14, 30],
    '--nr-tooltip-bg':       [0.94, 0.005, 250],
    '--nr-tooltip-border':   [0.85, 0.005, 250],
    '--nr-shadow-card$a':    0.05,
    '--nr-shadow-popup$a':   0.10,
    '--nr-shadow-overlay$a': 0.20,
  }],
  [17, { // Golden hour — warm honey
    '--nr-bg-body':          [0.90, 0.03, 75],
    '--nr-text-primary':     [0.20, 0.02, 50],
    '--nr-text-inverse':     [0.12, 0.02, 50],
    '--nr-text-secondary':   [0.42, 0.02, 55],
    '--nr-text-quaternary':  [0.60, 0.015, 60],
    '--nr-bg-raised':        [0.85, 0.03, 72],
    '--nr-bg-surface':       [0.87, 0.03, 72],
    '--nr-bg-input':         [0.85, 0.03, 72],
    '--nr-border-default':   [0.78, 0.025, 68],
    '--nr-border-strong':    [0.72, 0.025, 65],
    '--nr-border-subtle':    [0.82, 0.025, 70],
    '--nr-border-dim':       [0.86, 0.02, 72],
    '--nr-bg-sunken':        [0.88, 0.03, 74],
    '--nr-bg-overlay':       [0.87, 0.03, 72],
    '--nr-text-link':        [0.48, 0.13, 40],
    '--nr-tooltip-bg':       [0.87, 0.03, 72],
    '--nr-tooltip-border':   [0.78, 0.025, 68],
    '--nr-shadow-card$a':    0.08,
    '--nr-shadow-popup$a':   0.15,
    '--nr-shadow-overlay$a': 0.25,
  }],
  [19, { // Dusk — soft peach-gray
    '--nr-bg-body':          [0.50, 0.03, 40],
    '--nr-text-primary':     [0.90, 0.01, 55],
    '--nr-text-inverse':     [0.95, 0.005, 55],
    '--nr-text-secondary':   [0.75, 0.015, 48],
    '--nr-text-quaternary':  [0.58, 0.012, 42],
    '--nr-bg-raised':        [0.48, 0.03, 40],
    '--nr-bg-surface':       [0.47, 0.03, 38],
    '--nr-bg-input':         [0.44, 0.03, 38],
    '--nr-border-default':   [0.52, 0.025, 42],
    '--nr-border-strong':    [0.56, 0.02, 44],
    '--nr-border-subtle':    [0.48, 0.025, 40],
    '--nr-border-dim':       [0.43, 0.02, 38],
    '--nr-bg-sunken':        [0.48, 0.03, 39],
    '--nr-bg-overlay':       [0.46, 0.03, 38],
    '--nr-text-link':        [0.72, 0.12, 45],
    '--nr-tooltip-bg':       [0.46, 0.03, 38],
    '--nr-tooltip-border':   [0.52, 0.025, 42],
    '--nr-shadow-card$a':    0.20,
    '--nr-shadow-popup$a':   0.35,
    '--nr-shadow-overlay$a': 0.40,
  }],
  [22, { // Night — deep blue-black
    '--nr-bg-body':          [0.18, 0.02, 260],
    '--nr-text-primary':     [0.78, 0.01, 250],
    '--nr-text-inverse':     [0.88, 0.005, 250],
    '--nr-text-secondary':   [0.55, 0.01, 255],
    '--nr-text-quaternary':  [0.38, 0.01, 255],
    '--nr-bg-raised':        [0.22, 0.02, 260],
    '--nr-bg-surface':       [0.20, 0.02, 260],
    '--nr-bg-input':         [0.17, 0.02, 260],
    '--nr-border-default':   [0.25, 0.015, 260],
    '--nr-border-strong':    [0.30, 0.015, 258],
    '--nr-border-subtle':    [0.22, 0.015, 260],
    '--nr-border-dim':       [0.19, 0.015, 260],
    '--nr-bg-sunken':        [0.16, 0.02, 260],
    '--nr-bg-overlay':       [0.19, 0.02, 260],
    '--nr-text-link':        [0.62, 0.10, 250],
    '--nr-tooltip-bg':       [0.19, 0.02, 260],
    '--nr-tooltip-border':   [0.25, 0.015, 260],
    '--nr-shadow-card$a':    0.30,
    '--nr-shadow-popup$a':   0.50,
    '--nr-shadow-overlay$a': 0.50,
  }],
];

export function _getDaylightHour() {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

export function _applyDaylightColors() {
  const kf = _daylightKeyframes;
  let h = _getDaylightHour();
  // Allow speed multiplier for testing
  if (_daylightSpeedMultiplier !== 1) {
    if (!window._daylightStartReal) window._daylightStartReal = Date.now();
    const elapsedMs = Date.now() - window._daylightStartReal;
    const elapsedHours = (elapsedMs / 1000 / 3600) * _daylightSpeedMultiplier;
    h = (new Date().getHours() + new Date().getMinutes() / 60 + elapsedHours) % 24;
  }

  // Find surrounding keyframes (wraps around midnight)
  let iA = kf.length - 1, iB = 0;
  for (let i = 0; i < kf.length; i++) {
    if (h < kf[i][0]) { iB = i; iA = (i - 1 + kf.length) % kf.length; break; }
    if (i === kf.length - 1) { iA = i; iB = 0; }
  }

  const hA = kf[iA][0], hB = kf[iB][0];
  let span = hB - hA;
  if (span <= 0) span += 24;
  let progress = h - hA;
  if (progress < 0) progress += 24;
  const t = span === 0 ? 0 : progress / span;

  const vA = kf[iA][1], vB = kf[iB][1];
  const el = document.documentElement;

  // First pass: interpolate all values and collect lightness for bg-body
  const lerped = {};
  let bgL = 0.5;
  for (const key of Object.keys(vA)) {
    if (key.endsWith('$a')) {
      lerped[key] = vA[key] + (vB[key] - vA[key]) * t;
    } else {
      lerped[key] = _lerpOklch(vA[key], vB[key], t);
      if (key === '--nr-bg-body') bgL = lerped[key][0];
    }
  }

  // Second pass: enforce text contrast against bg-body
  // Text variables that must be readable against the background
  const _textKeys = {
    '--nr-text-primary': 0.55, '--nr-text-inverse': 0.65, '--nr-text-secondary': 0.35,
    '--nr-text-quaternary': 0.18,
    '--nr-text-link': 0.35,
  };
  for (const [key, minGap] of Object.entries(_textKeys)) {
    if (!lerped[key]) continue;
    const tL = lerped[key][0];
    const gap = Math.abs(tL - bgL);
    if (gap < minGap) {
      // Push text to the opposite side of bg
      if (bgL > 0.5) {
        lerped[key] = [bgL - minGap, lerped[key][1], lerped[key][2]];
      } else {
        lerped[key] = [bgL + minGap, lerped[key][1], lerped[key][2]];
      }
    }
  }

  // Apply interpolated colors
  for (const key of Object.keys(vA)) {
    if (key.endsWith('$a')) {
      const alpha = lerped[key];
      const cssVar = key.slice(0, -2);
      el.style.setProperty(cssVar, `rgba(0,0,0,${alpha.toFixed(3)})`);
    } else {
      el.style.setProperty(key, _oklchToHex(lerped[key][0], lerped[key][1], lerped[key][2]));
    }
  }
}

export function startDaylightTheme() {
  stopDaylightTheme();
  document.documentElement.setAttribute('data-theme', 'daylight');
  _applyDaylightColors();
  _daylightInterval = setInterval(_applyDaylightColors, 60000);
}

export function stopDaylightTheme() {
  if (_daylightInterval) { clearInterval(_daylightInterval); _daylightInterval = null; }
  window._daylightStartReal = null;
  // Remove all inline --nr-* properties set by daylight
  const el = document.documentElement;
  const kf0 = _daylightKeyframes[0][1];
  for (const key of Object.keys(kf0)) {
    el.style.removeProperty(key.endsWith('$a') ? key.slice(0, -2) : key);
  }
}

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

