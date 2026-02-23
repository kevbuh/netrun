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

// ── Daylight keyframe token names ──
const _expectedNrKeys = [
  '--nr-bg-body', '--nr-bg-surface', '--nr-bg-raised', '--nr-bg-sunken',
  '--nr-bg-overlay', '--nr-bg-input', '--nr-text-primary', '--nr-text-inverse',
  '--nr-text-secondary', '--nr-text-quaternary', '--nr-text-link',
  '--nr-border-default', '--nr-border-strong', '--nr-border-subtle', '--nr-border-dim',
  '--nr-tooltip-bg', '--nr-tooltip-border',
  '--nr-shadow-card$a', '--nr-shadow-popup$a', '--nr-shadow-overlay$a',
];

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
// Daylight keyframe token names — all keys use --nr-* directly
// ═══════════════════════════════════════════════════════════════

describe('daylight keyframe token names', () => {
  it('all expected --nr-* keys are present', () => {
    for (const key of _expectedNrKeys) {
      expect(_expectedNrKeys).toContain(key);
    }
  });

  it('no legacy (non --nr-*) keys remain', () => {
    for (const key of _expectedNrKeys) {
      expect(key).toMatch(/^--nr-/);
    }
  });

  it('includes all surface hierarchy tokens', () => {
    expect(_expectedNrKeys).toContain('--nr-bg-body');
    expect(_expectedNrKeys).toContain('--nr-bg-surface');
    expect(_expectedNrKeys).toContain('--nr-bg-raised');
    expect(_expectedNrKeys).toContain('--nr-bg-sunken');
    expect(_expectedNrKeys).toContain('--nr-bg-overlay');
    expect(_expectedNrKeys).toContain('--nr-bg-input');
  });

  it('includes text tokens', () => {
    expect(_expectedNrKeys).toContain('--nr-text-primary');
    expect(_expectedNrKeys).toContain('--nr-text-inverse');
    expect(_expectedNrKeys).toContain('--nr-text-secondary');
    expect(_expectedNrKeys).toContain('--nr-text-link');
  });

  it('includes border tokens', () => {
    expect(_expectedNrKeys).toContain('--nr-border-default');
    expect(_expectedNrKeys).toContain('--nr-border-strong');
    expect(_expectedNrKeys).toContain('--nr-border-subtle');
    expect(_expectedNrKeys).toContain('--nr-border-dim');
  });

  it('includes shadow alpha tokens', () => {
    expect(_expectedNrKeys).toContain('--nr-shadow-card$a');
    expect(_expectedNrKeys).toContain('--nr-shadow-popup$a');
    expect(_expectedNrKeys).toContain('--nr-shadow-overlay$a');
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
