import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from settings.js logic
// ──────────────────────────────────────────────────────────

/**
 * Map each theme to its underlying color scheme (dark or light)
 * Extracted from settings.js THEME_COLOR_SCHEME
 */
const THEME_COLOR_SCHEME = {
  dark: 'dark',
  light: 'light',
  sepia: 'light',
  daylight: 'light',
};

/**
 * Get the color scheme for a given theme
 * Extracted from settings.js getThemeColorScheme()
 */
function getThemeColorScheme(theme, systemScheme = 'light') {
  if (theme === 'auto') return systemScheme;
  return THEME_COLOR_SCHEME[theme] || 'light';
}

/**
 * Toggle sidebar icon visibility
 * Extracted from settings.js toggleSidebarIcon() — pure data logic only
 */
function toggleSidebarIconData(hidden, id, visible) {
  if (visible) {
    return hidden.filter(h => h !== id);
  } else {
    if (!hidden.includes(id)) return [...hidden, id];
    return [...hidden];
  }
}

/**
 * OKLCh to Hex color conversion
 * Extracted from settings.js _oklchToHex()
 */
function _oklchToHex(L, C, H) {
  const hRad = H * Math.PI / 180;
  const a_ = C * Math.cos(hRad), b_ = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
  const m_ = L - 0.1055613458 * a_ - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a_ - 1.2914855480 * b_;
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
  const gamma = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  r = Math.round(Math.max(0, Math.min(1, gamma(r))) * 255);
  g = Math.round(Math.max(0, Math.min(1, gamma(g))) * 255);
  b = Math.round(Math.max(0, Math.min(1, gamma(b))) * 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Lerp between two OKLCh colors
 * Extracted from settings.js _lerpOklch()
 */
function _lerpOklch(a, b, t) {
  const L = a[0] + (b[0] - a[0]) * t;
  const C = a[1] + (b[1] - a[1]) * t;
  let dH = b[2] - a[2];
  if (dH > 180) dH -= 360; else if (dH < -180) dH += 360;
  const H = (a[2] + dH * t + 360) % 360;
  return [L, C, H];
}

/**
 * Settings sections definition
 * Extracted from settings.js _SETTINGS_SECTIONS
 */
const _SETTINGS_SECTIONS = [
  { key: 'profile', label: 'Profile' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'feed', label: 'Feed & Reading' },
  { key: 'tools', label: 'Tools' },
  { key: 'browser', label: 'Browser' },
  { key: 'panel', label: 'Lookup Panel' },
  { key: 'agent', label: 'Agent' },
  { key: 'help', label: 'Help' },
];

/**
 * Accent color presets
 * Extracted from settings.js _renderAppearanceSettings()
 */
const ACCENT_COLORS = [
  { color: '#b4451a', name: 'Orange' },
  { color: '#e53e3e', name: 'Red' },
  { color: '#d69e2e', name: 'Gold' },
  { color: '#38a169', name: 'Green' },
  { color: '#3182ce', name: 'Blue' },
  { color: '#805ad5', name: 'Purple' },
  { color: '#d53f8c', name: 'Pink' },
  { color: '#718096', name: 'Gray' },
  { color: '#111111', name: 'Black' },
];

/**
 * Quality cache statistics calculation
 * Extracted from settings.js _renderFeedQualityTab()
 */
function qualityCacheStats(cache) {
  const entries = Object.entries(cache);
  const keptCount = entries.filter(([, v]) => (v?.v || v) === 'keep').length;
  const skippedCount = entries.filter(([, v]) => (v?.v || v) === 'skip').length;
  return { total: entries.length, kept: keptCount, skipped: skippedCount };
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Theme Color Scheme', () => {
  it('should return dark for dark theme', () => {
    expect(getThemeColorScheme('dark')).toBe('dark');
  });

  it('should return light for light theme', () => {
    expect(getThemeColorScheme('light')).toBe('light');
  });

  it('should return light for sepia theme', () => {
    expect(getThemeColorScheme('sepia')).toBe('light');
  });

  it('should return light for daylight theme', () => {
    expect(getThemeColorScheme('daylight')).toBe('light');
  });

  it('should return system scheme for auto theme', () => {
    expect(getThemeColorScheme('auto', 'dark')).toBe('dark');
    expect(getThemeColorScheme('auto', 'light')).toBe('light');
  });

  it('should default to light for unknown themes', () => {
    expect(getThemeColorScheme('unknown')).toBe('light');
    expect(getThemeColorScheme('')).toBe('light');
  });
});

describe('Settings Sections', () => {
  it('should have 8 sections', () => {
    expect(_SETTINGS_SECTIONS).toHaveLength(8);
  });

  it('should have unique keys', () => {
    const keys = _SETTINGS_SECTIONS.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should include all expected sections', () => {
    const keys = _SETTINGS_SECTIONS.map(s => s.key);
    expect(keys).toContain('profile');
    expect(keys).toContain('appearance');
    expect(keys).toContain('feed');
    expect(keys).toContain('tools');
    expect(keys).toContain('browser');
    expect(keys).toContain('panel');
    expect(keys).toContain('agent');
    expect(keys).toContain('help');
  });
});

describe('Accent Colors', () => {
  it('should have 9 presets', () => {
    expect(ACCENT_COLORS).toHaveLength(9);
  });

  it('should all be valid hex colors', () => {
    ACCENT_COLORS.forEach(a => {
      expect(a.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('should have default accent as first entry', () => {
    expect(ACCENT_COLORS[0].color).toBe('#b4451a');
    expect(ACCENT_COLORS[0].name).toBe('Orange');
  });

  it('should have unique colors', () => {
    const colors = ACCENT_COLORS.map(a => a.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('should have unique names', () => {
    const names = ACCENT_COLORS.map(a => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Sidebar Icon Visibility', () => {
  it('should add icon to hidden list when making invisible', () => {
    const result = toggleSidebarIconData([], 'sb-browse', false);
    expect(result).toEqual(['sb-browse']);
  });

  it('should remove icon from hidden list when making visible', () => {
    const result = toggleSidebarIconData(['sb-browse', 'sb-vault'], 'sb-browse', true);
    expect(result).toEqual(['sb-vault']);
  });

  it('should not duplicate when hiding already hidden icon', () => {
    const result = toggleSidebarIconData(['sb-browse'], 'sb-browse', false);
    expect(result).toEqual(['sb-browse']);
  });

  it('should handle making visible an icon not in hidden list', () => {
    const result = toggleSidebarIconData(['sb-vault'], 'sb-browse', true);
    expect(result).toEqual(['sb-vault']);
  });

  it('should handle empty hidden list when making visible', () => {
    const result = toggleSidebarIconData([], 'sb-browse', true);
    expect(result).toEqual([]);
  });
});

describe('OKLCh Color Conversion', () => {
  it('should convert black (L=0)', () => {
    const hex = _oklchToHex(0, 0, 0);
    expect(hex).toBe('#000000');
  });

  it('should convert white (L=1, C=0)', () => {
    const hex = _oklchToHex(1, 0, 0);
    expect(hex).toBe('#ffffff');
  });

  it('should return valid hex for arbitrary values', () => {
    const hex = _oklchToHex(0.7, 0.15, 30);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('should clamp out-of-gamut values', () => {
    const hex = _oklchToHex(0.5, 0.4, 120);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('should produce different colors for different hues', () => {
    const red = _oklchToHex(0.6, 0.2, 30);
    const green = _oklchToHex(0.6, 0.2, 150);
    const blue = _oklchToHex(0.6, 0.2, 270);
    expect(red).not.toBe(green);
    expect(green).not.toBe(blue);
    expect(red).not.toBe(blue);
  });
});

describe('OKLCh Lerp', () => {
  it('should return start color at t=0', () => {
    const result = _lerpOklch([0.5, 0.1, 30], [0.8, 0.2, 90], 0);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(0.1);
    expect(result[2]).toBeCloseTo(30);
  });

  it('should return end color at t=1', () => {
    const result = _lerpOklch([0.5, 0.1, 30], [0.8, 0.2, 90], 1);
    expect(result[0]).toBeCloseTo(0.8);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(90);
  });

  it('should interpolate midpoint correctly', () => {
    const result = _lerpOklch([0.4, 0.1, 0], [0.8, 0.3, 60], 0.5);
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(30);
  });

  it('should take shortest arc for hue wrapping', () => {
    // 350 -> 10 should go through 0, not 180
    const result = _lerpOklch([0.5, 0.1, 350], [0.5, 0.1, 10], 0.5);
    expect(result[2]).toBeCloseTo(0, 0); // midpoint should be near 0/360
  });

  it('should handle hue wrapping in reverse', () => {
    // 10 -> 350 should go through 0, not 180
    const result = _lerpOklch([0.5, 0.1, 10], [0.5, 0.1, 350], 0.5);
    expect(result[2]).toBeCloseTo(0, 0);
  });
});

describe('Quality Cache Stats', () => {
  it('should count kept and skipped with new format', () => {
    const cache = {
      'Paper A': { v: 'keep', s: 80 },
      'Paper B': { v: 'skip' },
      'Paper C': { v: 'keep', s: 45 },
      'Paper D': { v: 'skip' },
      'Paper E': { v: 'keep', s: 90 },
    };
    const stats = qualityCacheStats(cache);
    expect(stats.total).toBe(5);
    expect(stats.kept).toBe(3);
    expect(stats.skipped).toBe(2);
  });

  it('should handle old format (verdict as string)', () => {
    const cache = {
      'Paper A': 'keep',
      'Paper B': 'skip',
      'Paper C': 'keep',
    };
    const stats = qualityCacheStats(cache);
    expect(stats.total).toBe(3);
    expect(stats.kept).toBe(2);
    expect(stats.skipped).toBe(1);
  });

  it('should handle empty cache', () => {
    const stats = qualityCacheStats({});
    expect(stats.total).toBe(0);
    expect(stats.kept).toBe(0);
    expect(stats.skipped).toBe(0);
  });

  it('should handle mixed old and new format', () => {
    const cache = {
      'Paper A': { v: 'keep', s: 80 },
      'Paper B': 'skip',
      'Paper C': 'keep',
    };
    const stats = qualityCacheStats(cache);
    expect(stats.total).toBe(3);
    expect(stats.kept).toBe(2);
    expect(stats.skipped).toBe(1);
  });
});
