/* ── Daylight Theme Engine ── */
var _daylightInterval = null;
var _daylightSpeedMultiplier = 1; // set to 1440 in console for fast-forward (1 day = 1 min)

// OKLCH→sRGB conversion
function _oklchToHex(L, C, H) {
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

function _lerpOklch(a, b, t) {
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
var _daylightKeyframes = [
  [5, { // Dawn — warm rose-gray
    '--bg-body':       [0.30, 0.02, 30],
    '--text-primary':  [0.85, 0.01, 60],
    '--text-white':    [0.92, 0.005, 60],
    '--text-muted':    [0.65, 0.01, 50],
    '--text-dim':      [0.55, 0.01, 40],
    '--text-dimmer':   [0.48, 0.01, 40],
    '--text-dimmest':  [0.40, 0.01, 40],
    '--bg-sidebar':    [0.25, 0.02, 30],
    '--border-sidebar':[0.22, 0.015, 30],
    '--bg-hover':      [0.28, 0.02, 30],
    '--bg-card':       [0.27, 0.02, 30],
    '--bg-input':      [0.24, 0.02, 30],
    '--bg-input-alt':  [0.27, 0.02, 30],
    '--border-card':   [0.32, 0.015, 30],
    '--border-input':  [0.38, 0.015, 35],
    '--border-subtle': [0.30, 0.015, 30],
    '--border-dim':    [0.24, 0.015, 30],
    '--bg-header':     [0.25, 0.02, 30],
    '--bg-canvas':     [0.28, 0.02, 30],
    '--bg-popup':      [0.26, 0.02, 30],
    '--bg-chip-count': [0.24, 0.02, 30],
    '--bg-cat-tag':    [0.24, 0.02, 30],
    '--bg-cat-tag-color':[0.65, 0.01, 50],
    '--bg-cite':       [0.28, 0.03, 50],
    '--bg-sidebar-cat':[0.28, 0.02, 30],
    '--sidebar-cat-border':[0.32, 0.015, 30],
    '--sidebar-cat-color':[0.65, 0.01, 50],
    '--text-link':     [0.65, 0.12, 50],
    '--text-summary':  [0.65, 0.01, 50],
    '--text-authors':  [0.60, 0.01, 50],
    '--text-meta-value':[0.75, 0.01, 55],
    '--text-idea-desc':[0.75, 0.01, 55],
    '--tree-edge':     [0.38, 0.015, 35],
    '--spinner-border':[0.38, 0.015, 35],
    '--tooltip-bg':    [0.26, 0.02, 30],
    '--tooltip-border':[0.32, 0.015, 30],
    '--shadow-card$a':  0.25,
    '--shadow-popup$a': 0.40,
    '--overlay-bg$a':   0.45,
  }],
  [8, { // Morning — warm cream
    '--bg-body':       [0.92, 0.02, 80],
    '--text-primary':  [0.25, 0.02, 50],
    '--text-white':    [0.15, 0.02, 50],
    '--text-muted':    [0.50, 0.02, 55],
    '--text-dim':      [0.60, 0.02, 60],
    '--text-dimmer':   [0.65, 0.015, 60],
    '--text-dimmest':  [0.72, 0.01, 65],
    '--bg-sidebar':    [0.90, 0.02, 78],
    '--border-sidebar':[0.85, 0.02, 75],
    '--bg-hover':      [0.88, 0.02, 78],
    '--bg-card':       [0.90, 0.02, 78],
    '--bg-input':      [0.88, 0.02, 78],
    '--bg-input-alt':  [0.90, 0.02, 78],
    '--border-card':   [0.82, 0.02, 72],
    '--border-input':  [0.75, 0.02, 68],
    '--border-subtle': [0.85, 0.02, 75],
    '--border-dim':    [0.88, 0.015, 78],
    '--bg-header':     [0.90, 0.02, 78],
    '--bg-canvas':     [0.91, 0.02, 79],
    '--bg-popup':      [0.90, 0.02, 78],
    '--bg-chip-count': [0.88, 0.02, 78],
    '--bg-cat-tag':    [0.88, 0.02, 78],
    '--bg-cat-tag-color':[0.50, 0.02, 55],
    '--bg-cite':       [0.92, 0.03, 70],
    '--bg-sidebar-cat':[0.88, 0.02, 78],
    '--sidebar-cat-border':[0.82, 0.02, 72],
    '--sidebar-cat-color':[0.50, 0.02, 55],
    '--text-link':     [0.50, 0.12, 45],
    '--text-summary':  [0.50, 0.02, 55],
    '--text-authors':  [0.55, 0.02, 58],
    '--text-meta-value':[0.40, 0.02, 50],
    '--text-idea-desc':[0.40, 0.02, 50],
    '--tree-edge':     [0.75, 0.02, 68],
    '--spinner-border':[0.75, 0.02, 68],
    '--tooltip-bg':    [0.90, 0.02, 78],
    '--tooltip-border':[0.82, 0.02, 72],
    '--shadow-card$a':  0.06,
    '--shadow-popup$a': 0.12,
    '--overlay-bg$a':   0.22,
  }],
  [12, { // Midday — bright neutral
    '--bg-body':       [0.96, 0.005, 250],
    '--text-primary':  [0.20, 0.01, 260],
    '--text-white':    [0.12, 0.01, 260],
    '--text-muted':    [0.48, 0.01, 255],
    '--text-dim':      [0.58, 0.008, 255],
    '--text-dimmer':   [0.64, 0.006, 255],
    '--text-dimmest':  [0.72, 0.005, 255],
    '--bg-sidebar':    [0.94, 0.005, 250],
    '--border-sidebar':[0.88, 0.005, 250],
    '--bg-hover':      [0.92, 0.005, 250],
    '--bg-card':       [0.94, 0.005, 250],
    '--bg-input':      [0.92, 0.005, 250],
    '--bg-input-alt':  [0.94, 0.005, 250],
    '--border-card':   [0.85, 0.005, 250],
    '--border-input':  [0.78, 0.008, 250],
    '--border-subtle': [0.88, 0.005, 250],
    '--border-dim':    [0.91, 0.004, 250],
    '--bg-header':     [0.94, 0.005, 250],
    '--bg-canvas':     [0.95, 0.005, 250],
    '--bg-popup':      [0.94, 0.005, 250],
    '--bg-chip-count': [0.92, 0.005, 250],
    '--bg-cat-tag':    [0.92, 0.005, 250],
    '--bg-cat-tag-color':[0.48, 0.01, 255],
    '--bg-cite':       [0.95, 0.02, 70],
    '--bg-sidebar-cat':[0.92, 0.005, 250],
    '--sidebar-cat-border':[0.85, 0.005, 250],
    '--sidebar-cat-color':[0.48, 0.01, 255],
    '--text-link':     [0.52, 0.14, 30],
    '--text-summary':  [0.48, 0.01, 255],
    '--text-authors':  [0.52, 0.01, 255],
    '--text-meta-value':[0.38, 0.01, 255],
    '--text-idea-desc':[0.38, 0.01, 255],
    '--tree-edge':     [0.78, 0.008, 250],
    '--spinner-border':[0.78, 0.008, 250],
    '--tooltip-bg':    [0.94, 0.005, 250],
    '--tooltip-border':[0.85, 0.005, 250],
    '--shadow-card$a':  0.05,
    '--shadow-popup$a': 0.10,
    '--overlay-bg$a':   0.20,
  }],
  [17, { // Golden hour — warm honey
    '--bg-body':       [0.90, 0.03, 75],
    '--text-primary':  [0.20, 0.02, 50],
    '--text-white':    [0.12, 0.02, 50],
    '--text-muted':    [0.42, 0.02, 55],
    '--text-dim':      [0.52, 0.02, 60],
    '--text-dimmer':   [0.60, 0.015, 60],
    '--text-dimmest':  [0.68, 0.01, 65],
    '--bg-sidebar':    [0.87, 0.03, 72],
    '--border-sidebar':[0.82, 0.025, 70],
    '--bg-hover':      [0.85, 0.03, 72],
    '--bg-card':       [0.87, 0.03, 72],
    '--bg-input':      [0.85, 0.03, 72],
    '--bg-input-alt':  [0.87, 0.03, 72],
    '--border-card':   [0.78, 0.025, 68],
    '--border-input':  [0.72, 0.025, 65],
    '--border-subtle': [0.82, 0.025, 70],
    '--border-dim':    [0.86, 0.02, 72],
    '--bg-header':     [0.87, 0.03, 72],
    '--bg-canvas':     [0.88, 0.03, 74],
    '--bg-popup':      [0.87, 0.03, 72],
    '--bg-chip-count': [0.85, 0.03, 72],
    '--bg-cat-tag':    [0.85, 0.03, 72],
    '--bg-cat-tag-color':[0.50, 0.02, 55],
    '--bg-cite':       [0.90, 0.04, 65],
    '--bg-sidebar-cat':[0.85, 0.03, 72],
    '--sidebar-cat-border':[0.78, 0.025, 68],
    '--sidebar-cat-color':[0.50, 0.02, 55],
    '--text-link':     [0.48, 0.13, 40],
    '--text-summary':  [0.42, 0.02, 55],
    '--text-authors':  [0.48, 0.02, 58],
    '--text-meta-value':[0.32, 0.02, 50],
    '--text-idea-desc':[0.32, 0.02, 50],
    '--tree-edge':     [0.72, 0.025, 65],
    '--spinner-border':[0.72, 0.025, 65],
    '--tooltip-bg':    [0.87, 0.03, 72],
    '--tooltip-border':[0.78, 0.025, 68],
    '--shadow-card$a':  0.08,
    '--shadow-popup$a': 0.15,
    '--overlay-bg$a':   0.25,
  }],
  [19, { // Dusk — soft peach-gray
    '--bg-body':       [0.50, 0.03, 40],
    '--text-primary':  [0.90, 0.01, 55],
    '--text-white':    [0.95, 0.005, 55],
    '--text-muted':    [0.75, 0.015, 48],
    '--text-dim':      [0.65, 0.015, 45],
    '--text-dimmer':   [0.58, 0.012, 42],
    '--text-dimmest':  [0.50, 0.01, 40],
    '--bg-sidebar':    [0.45, 0.03, 38],
    '--border-sidebar':[0.40, 0.025, 38],
    '--bg-hover':      [0.48, 0.03, 40],
    '--bg-card':       [0.47, 0.03, 38],
    '--bg-input':      [0.44, 0.03, 38],
    '--bg-input-alt':  [0.47, 0.03, 38],
    '--border-card':   [0.52, 0.025, 42],
    '--border-input':  [0.56, 0.02, 44],
    '--border-subtle': [0.48, 0.025, 40],
    '--border-dim':    [0.43, 0.02, 38],
    '--bg-header':     [0.45, 0.03, 38],
    '--bg-canvas':     [0.48, 0.03, 39],
    '--bg-popup':      [0.46, 0.03, 38],
    '--bg-chip-count': [0.44, 0.03, 38],
    '--bg-cat-tag':    [0.44, 0.03, 38],
    '--bg-cat-tag-color':[0.75, 0.015, 48],
    '--bg-cite':       [0.48, 0.04, 50],
    '--bg-sidebar-cat':[0.48, 0.03, 40],
    '--sidebar-cat-border':[0.52, 0.025, 42],
    '--sidebar-cat-color':[0.75, 0.015, 48],
    '--text-link':     [0.72, 0.12, 45],
    '--text-summary':  [0.75, 0.015, 48],
    '--text-authors':  [0.70, 0.015, 46],
    '--text-meta-value':[0.82, 0.01, 52],
    '--text-idea-desc':[0.82, 0.01, 52],
    '--tree-edge':     [0.56, 0.02, 44],
    '--spinner-border':[0.56, 0.02, 44],
    '--tooltip-bg':    [0.46, 0.03, 38],
    '--tooltip-border':[0.52, 0.025, 42],
    '--shadow-card$a':  0.20,
    '--shadow-popup$a': 0.35,
    '--overlay-bg$a':   0.40,
  }],
  [22, { // Night — deep blue-black
    '--bg-body':       [0.18, 0.02, 260],
    '--text-primary':  [0.78, 0.01, 250],
    '--text-white':    [0.88, 0.005, 250],
    '--text-muted':    [0.55, 0.01, 255],
    '--text-dim':      [0.45, 0.01, 255],
    '--text-dimmer':   [0.38, 0.01, 255],
    '--text-dimmest':  [0.32, 0.01, 255],
    '--bg-sidebar':    [0.15, 0.02, 260],
    '--border-sidebar':[0.20, 0.015, 260],
    '--bg-hover':      [0.22, 0.02, 260],
    '--bg-card':       [0.20, 0.02, 260],
    '--bg-input':      [0.17, 0.02, 260],
    '--bg-input-alt':  [0.20, 0.02, 260],
    '--border-card':   [0.25, 0.015, 260],
    '--border-input':  [0.30, 0.015, 258],
    '--border-subtle': [0.22, 0.015, 260],
    '--border-dim':    [0.19, 0.015, 260],
    '--bg-header':     [0.15, 0.02, 260],
    '--bg-canvas':     [0.16, 0.02, 260],
    '--bg-popup':      [0.19, 0.02, 260],
    '--bg-chip-count': [0.17, 0.02, 260],
    '--bg-cat-tag':    [0.17, 0.02, 260],
    '--bg-cat-tag-color':[0.55, 0.01, 255],
    '--bg-cite':       [0.20, 0.03, 40],
    '--bg-sidebar-cat':[0.22, 0.02, 260],
    '--sidebar-cat-border':[0.25, 0.015, 260],
    '--sidebar-cat-color':[0.55, 0.01, 255],
    '--text-link':     [0.62, 0.10, 250],
    '--text-summary':  [0.55, 0.01, 255],
    '--text-authors':  [0.50, 0.01, 255],
    '--text-meta-value':[0.68, 0.01, 252],
    '--text-idea-desc':[0.68, 0.01, 252],
    '--tree-edge':     [0.30, 0.015, 258],
    '--spinner-border':[0.30, 0.015, 258],
    '--tooltip-bg':    [0.19, 0.02, 260],
    '--tooltip-border':[0.25, 0.015, 260],
    '--shadow-card$a':  0.30,
    '--shadow-popup$a': 0.50,
    '--overlay-bg$a':   0.50,
  }],
];

function _getDaylightHour() {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function _applyDaylightColors() {
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
      if (key === '--bg-body') bgL = lerped[key][0];
    }
  }

  // Second pass: enforce text contrast against bg-body
  // Text variables that must be readable against the background
  const _textKeys = {
    '--text-primary': 0.55, '--text-white': 0.65, '--text-muted': 0.35,
    '--text-dim': 0.25, '--text-dimmer': 0.18, '--text-dimmest': 0.12,
    '--text-link': 0.35, '--text-summary': 0.35, '--text-authors': 0.30,
    '--text-meta-value': 0.40, '--text-idea-desc': 0.40,
    '--bg-cat-tag-color': 0.30, '--sidebar-cat-color': 0.30,
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

  // Map legacy keyframe names → --nr-* token names
  var _nrMap = {
    '--bg-body': '--nr-bg-body', '--bg-card': '--nr-bg-surface',
    '--bg-hover': '--nr-bg-raised', '--bg-canvas': '--nr-bg-sunken',
    '--bg-popup': '--nr-bg-overlay', '--bg-input': '--nr-bg-input',
    '--bg-input-alt': '--nr-bg-surface',
    '--text-primary': '--nr-text-primary', '--text-white': '--nr-text-inverse',
    '--text-muted': '--nr-text-secondary', '--text-dim': '--nr-text-tertiary',
    '--text-dimmer': '--nr-text-quaternary', '--text-link': '--nr-text-link',
    '--border-card': '--nr-border-default', '--border-input': '--nr-border-strong',
    '--border-subtle': '--nr-border-subtle', '--border-dim': '--nr-border-dim',
    '--tree-edge': '--nr-border-strong', '--spinner-border': '--nr-border-strong',
    '--tooltip-bg': '--nr-tooltip-bg', '--tooltip-border': '--nr-tooltip-border',
    '--shadow-card': '--nr-shadow-card', '--shadow-popup': '--nr-shadow-popup',
    '--overlay-bg': '--nr-shadow-overlay',
  };

  // Apply — write only --nr-* vars (legacy aliases removed)
  for (const key of Object.keys(vA)) {
    if (key.endsWith('$a')) {
      const alpha = lerped[key];
      const cssVar = key.slice(0, -2);
      const val = `rgba(0,0,0,${alpha.toFixed(3)})`;
      el.style.setProperty(_nrMap[cssVar] || cssVar, val);
    } else {
      const hex = _oklchToHex(lerped[key][0], lerped[key][1], lerped[key][2]);
      el.style.setProperty(_nrMap[key] || key, hex);
    }
  }
}

function startDaylightTheme() {
  stopDaylightTheme();
  document.documentElement.setAttribute('data-theme', 'daylight');
  _applyDaylightColors();
  _daylightInterval = setInterval(_applyDaylightColors, 60000);
}

function stopDaylightTheme() {
  if (_daylightInterval) { clearInterval(_daylightInterval); _daylightInterval = null; }
  window._daylightStartReal = null;
  // Remove all inline --nr-* properties set by daylight
  var _nrMap = {
    '--bg-body': '--nr-bg-body', '--bg-card': '--nr-bg-surface',
    '--bg-hover': '--nr-bg-raised', '--bg-canvas': '--nr-bg-sunken',
    '--bg-popup': '--nr-bg-overlay', '--bg-input': '--nr-bg-input',
    '--bg-input-alt': '--nr-bg-surface',
    '--text-primary': '--nr-text-primary', '--text-white': '--nr-text-inverse',
    '--text-muted': '--nr-text-secondary', '--text-dim': '--nr-text-tertiary',
    '--text-dimmer': '--nr-text-quaternary', '--text-link': '--nr-text-link',
    '--border-card': '--nr-border-default', '--border-input': '--nr-border-strong',
    '--border-subtle': '--nr-border-subtle', '--border-dim': '--nr-border-dim',
    '--tree-edge': '--nr-border-strong', '--spinner-border': '--nr-border-strong',
    '--tooltip-bg': '--nr-tooltip-bg', '--tooltip-border': '--nr-tooltip-border',
    '--shadow-card': '--nr-shadow-card', '--shadow-popup': '--nr-shadow-popup',
    '--overlay-bg': '--nr-shadow-overlay',
  };
  const el = document.documentElement;
  const kf0 = _daylightKeyframes[0][1];
  for (const key of Object.keys(kf0)) {
    const cssVar = key.endsWith('$a') ? key.slice(0, -2) : key;
    el.style.removeProperty(_nrMap[cssVar] || cssVar);
  }
}

function setAccentColor(color) {
  localStorage.setItem('accentColor', color);
  applyAccentColor(color);
  // Update swatch rings
  document.querySelectorAll('[onclick^="setAccentColor"]').forEach(btn => {
    const isActive = btn.getAttribute('onclick') === `setAccentColor('${color}')`;
    btn.className = `w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ${isActive ? 'scale-110 ring-2 ring-offset-2' : ''}`;
    if (isActive) {
      btn.style.setProperty('--tw-ring-color', color);
      btn.style.setProperty('--tw-ring-offset-color', 'var(--nr-bg-body)');
    } else {
      btn.style.removeProperty('--tw-ring-color');
      btn.style.removeProperty('--tw-ring-offset-color');
    }
  });
}

let _spinnerPreviewInterval = null;

function cycleSpinner(dir) {
  if (!_spinnerData || !_spinnerNames.length) return;
  const current = getSelectedSpinner();
  let idx = _spinnerNames.indexOf(current);
  if (idx === -1) idx = 0;
  idx = (idx + dir + _spinnerNames.length) % _spinnerNames.length;
  const name = _spinnerNames[idx];
  setSelectedSpinner(name);
  updateSpinnerPreview(name);
}

function updateSpinnerPreview(name) {
  const el = document.getElementById('spinner-preview');
  const nameEl = document.getElementById('spinner-name');
  if (!el || !_spinnerData) return;
  if (nameEl) nameEl.textContent = name;
  const spinner = _spinnerData[name];
  if (!spinner) return;
  if (_spinnerPreviewInterval) clearInterval(_spinnerPreviewInterval);
  let i = 0;
  el.textContent = spinner.frames[0];
  _spinnerPreviewInterval = setInterval(() => {
    i = (i + 1) % spinner.frames.length;
    el.textContent = spinner.frames[i];
  }, spinner.interval);
}

function applyAccentColor(color) {
  // Compute a lighter hover variant
  const r = parseInt(color.slice(1,3), 16), g = parseInt(color.slice(3,5), 16), b = parseInt(color.slice(5,7), 16);
  const hover = '#' + [Math.min(255, r + 20), Math.min(255, g + 20), Math.min(255, b + 20)].map(v => v.toString(16).padStart(2, '0')).join('');
  document.documentElement.style.setProperty('--nr-accent', color);
  document.documentElement.style.setProperty('--nr-accent-hover', hover);
}

function setAetherColor(mode) {
  localStorage.setItem('aetherColor', mode);
  document.documentElement.setAttribute('data-aether-theme', mode);
  renderSettingsView();
}
