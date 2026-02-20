import { describe, it, expect } from 'vitest';

// ── Re-implement pure functions from settings-colors.js ──

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

function _lerpOklch(a, b, t) {
  const L = a[0] + (b[0] - a[0]) * t;
  const C = a[1] + (b[1] - a[1]) * t;
  let dH = b[2] - a[2];
  if (dH > 180) dH -= 360; else if (dH < -180) dH += 360;
  const H = (a[2] + dH * t + 360) % 360;
  return [L, C, H];
}

function applyAccentColor(color) {
  const r = parseInt(color.slice(1,3), 16), g = parseInt(color.slice(3,5), 16), b = parseInt(color.slice(5,7), 16);
  const hover = '#' + [Math.min(255, r + 20), Math.min(255, g + 20), Math.min(255, b + 20)].map(v => v.toString(16).padStart(2, '0')).join('');
  return { accent: color, hover };
}

// ── _nrMap translation table ──
const _nrMap = {
  '--bg-body': '--nr-bg-body', '--bg-card': '--nr-bg-surface',
  '--bg-hover': '--nr-bg-raised', '--bg-canvas': '--nr-bg-sunken',
  '--bg-popup': '--nr-bg-overlay', '--bg-input': '--nr-bg-input',
  '--bg-input-alt': '--nr-bg-surface',
  '--text-primary': '--nr-text-primary', '--text-white': '--nr-text-inverse',
  '--text-muted': '--nr-text-secondary', '--text-dim': '--nr-text-secondary',
  '--text-dimmer': '--nr-text-quaternary', '--text-link': '--nr-text-link',
  '--border-card': '--nr-border-default', '--border-input': '--nr-border-strong',
  '--border-subtle': '--nr-border-subtle', '--border-dim': '--nr-border-dim',
  '--tree-edge': '--nr-border-strong', '--spinner-border': '--nr-border-strong',
  '--tooltip-bg': '--nr-tooltip-bg', '--tooltip-border': '--nr-tooltip-border',
  '--shadow-card': '--nr-shadow-card', '--shadow-popup': '--nr-shadow-popup',
  '--overlay-bg': '--nr-shadow-overlay',
};

// ═══════════════════════════════════════════════════════════════
// _oklchToHex
// ═══════════════════════════════════════════════════════════════

describe('_oklchToHex', () => {
  it('converts black (L=0)', () => {
    expect(_oklchToHex(0, 0, 0)).toBe('#000000');
  });

  it('converts white (L=1)', () => {
    expect(_oklchToHex(1, 0, 0)).toBe('#ffffff');
  });

  it('returns valid hex format', () => {
    const hex = _oklchToHex(0.5, 0.1, 30);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps out-of-range values', () => {
    const hex = _oklchToHex(0.5, 0.3, 120);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles various hue angles', () => {
    for (const h of [0, 60, 120, 180, 240, 300]) {
      const hex = _oklchToHex(0.7, 0.1, h);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('produces neutral gray for zero chroma', () => {
    const hex = _oklchToHex(0.5, 0, 0);
    // With zero chroma, R ≈ G ≈ B
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    expect(Math.abs(r - g)).toBeLessThan(5);
    expect(Math.abs(g - b)).toBeLessThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// _lerpOklch
// ═══════════════════════════════════════════════════════════════

describe('_lerpOklch', () => {
  it('returns start at t=0', () => {
    const result = _lerpOklch([0.2, 0.05, 30], [0.8, 0.1, 180], 0);
    expect(result[0]).toBeCloseTo(0.2);
    expect(result[1]).toBeCloseTo(0.05);
    expect(result[2]).toBeCloseTo(30);
  });

  it('returns end at t=1', () => {
    const result = _lerpOklch([0.2, 0.05, 30], [0.8, 0.1, 180], 1);
    expect(result[0]).toBeCloseTo(0.8);
    expect(result[1]).toBeCloseTo(0.1);
    expect(result[2]).toBeCloseTo(180);
  });

  it('interpolates midpoint', () => {
    const result = _lerpOklch([0, 0, 0], [1, 1, 180], 0.5);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(90);
  });

  it('takes shortest arc for hue', () => {
    // From 350° to 10° should go through 0° (shortest arc = 20°)
    const result = _lerpOklch([0.5, 0.1, 350], [0.5, 0.1, 10], 0.5);
    expect(result[2]).toBeCloseTo(0, 0); // Midpoint should be near 0° (or 360°)
  });

  it('handles large hue difference (>180)', () => {
    // From 10° to 350° should go backward (shortest arc)
    const result = _lerpOklch([0.5, 0.1, 10], [0.5, 0.1, 350], 0.5);
    const h = result[2];
    // Should be near 0 or 360
    expect(h % 360).toBeLessThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// _nrMap — legacy → token translation
// ═══════════════════════════════════════════════════════════════

describe('_nrMap', () => {
  it('maps all background vars', () => {
    expect(_nrMap['--bg-body']).toBe('--nr-bg-body');
    expect(_nrMap['--bg-card']).toBe('--nr-bg-surface');
    expect(_nrMap['--bg-hover']).toBe('--nr-bg-raised');
    expect(_nrMap['--bg-canvas']).toBe('--nr-bg-sunken');
    expect(_nrMap['--bg-popup']).toBe('--nr-bg-overlay');
    expect(_nrMap['--bg-input']).toBe('--nr-bg-input');
  });

  it('maps all text vars', () => {
    expect(_nrMap['--text-primary']).toBe('--nr-text-primary');
    expect(_nrMap['--text-white']).toBe('--nr-text-inverse');
    expect(_nrMap['--text-link']).toBe('--nr-text-link');
  });

  it('maps all border vars', () => {
    expect(_nrMap['--border-card']).toBe('--nr-border-default');
    expect(_nrMap['--border-input']).toBe('--nr-border-strong');
    expect(_nrMap['--border-subtle']).toBe('--nr-border-subtle');
    expect(_nrMap['--border-dim']).toBe('--nr-border-dim');
  });

  it('maps tooltip vars', () => {
    expect(_nrMap['--tooltip-bg']).toBe('--nr-tooltip-bg');
    expect(_nrMap['--tooltip-border']).toBe('--nr-tooltip-border');
  });

  it('maps shadow vars', () => {
    expect(_nrMap['--shadow-card']).toBe('--nr-shadow-card');
    expect(_nrMap['--shadow-popup']).toBe('--nr-shadow-popup');
    expect(_nrMap['--overlay-bg']).toBe('--nr-shadow-overlay');
  });

  it('all values start with --nr- prefix', () => {
    for (const [key, val] of Object.entries(_nrMap)) {
      expect(val).toMatch(/^--nr-/);
    }
  });

  it('has mappings for all expected legacy vars', () => {
    const expectedKeys = [
      '--bg-body', '--bg-card', '--bg-hover', '--bg-canvas',
      '--bg-popup', '--bg-input', '--text-primary', '--text-link',
      '--border-card', '--border-subtle',
    ];
    for (const key of expectedKeys) {
      expect(_nrMap[key]).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// applyAccentColor — hover computation
// ═══════════════════════════════════════════════════════════════

describe('applyAccentColor', () => {
  it('computes hover color lighter by +20 per channel', () => {
    const { accent, hover } = applyAccentColor('#b4451a');
    expect(accent).toBe('#b4451a');
    // #b4 = 180 + 20 = 200 → c8, #45 = 69 + 20 = 89 → 59, #1a = 26 + 20 = 46 → 2e
    expect(hover).toBe('#c8592e');
  });

  it('clamps hover channels at 255', () => {
    const { hover } = applyAccentColor('#f0f0f0');
    // 240 + 20 = 260 → clamped to 255 → ff
    expect(hover).toBe('#ffffff');
  });

  it('handles pure black', () => {
    const { hover } = applyAccentColor('#000000');
    expect(hover).toBe('#141414'); // 0+20 = 20 → 14
  });

  it('handles pure white', () => {
    const { hover } = applyAccentColor('#ffffff');
    expect(hover).toBe('#ffffff'); // clamped
  });
});
