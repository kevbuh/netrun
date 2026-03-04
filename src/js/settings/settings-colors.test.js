import { describe, it, expect } from 'vitest';

// ── Re-implement pure functions from settings-colors.js ──

function applyAccentColor(color) {
  const r = parseInt(color.slice(1,3), 16), g = parseInt(color.slice(3,5), 16), b = parseInt(color.slice(5,7), 16);
  const hover = '#' + [Math.min(255, r + 20), Math.min(255, g + 20), Math.min(255, b + 20)].map(v => v.toString(16).padStart(2, '0')).join('');
  return { accent: color, hover };
}

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
