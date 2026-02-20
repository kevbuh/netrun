import { describe, it, expect } from 'vitest';

// ── Re-implement the pure token resolution helpers from view.js ──
// These are module-private functions, so we replicate them for testing.

function _spaceToken(v) {
  if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
  if (typeof v === 'string' && v.match(/^\d/)) return v;
  return v;
}

function _radiusToken(v) {
  var map = { xs: 'xs', sm: 'sm', md: 'md', lg: 'lg', xl: 'xl', '2xl': '2xl', full: 'full' };
  if (map[v]) return 'var(--nr-radius-' + v + ')';
  return v;
}

function _colorToken(name) {
  if (!name) return name;
  if (name.startsWith('var(') || name.startsWith('#') || name.startsWith('rgb') || name.startsWith('hsl')) return name;
  if (name.startsWith('--')) return 'var(' + name + ')';
  var map = {
    body: '--nr-bg-body', surface: '--nr-bg-surface', raised: '--nr-bg-raised',
    sunken: '--nr-bg-sunken', overlay: '--nr-bg-overlay', input: '--nr-bg-input',
    primary: '--nr-text-primary', secondary: '--nr-text-secondary',
    tertiary: '--nr-text-tertiary', quaternary: '--nr-text-quaternary',
    inverse: '--nr-text-inverse', link: '--nr-text-link',
    accent: '--nr-accent', 'accent-hover': '--nr-accent-hover',
    'border-default': '--nr-border-default', 'border-strong': '--nr-border-strong',
    'border-subtle': '--nr-border-subtle', 'border-dim': '--nr-border-dim'
  };
  if (map[name]) return 'var(' + map[name] + ')';
  return name;
}

function _fontToken(name) {
  // Simplified: returns scale object for known names, null otherwise
  var scale = {
    largeTitle: { size: '34px', weight: '700', lineHeight: '41px' },
    body: { size: '17px', weight: '400', lineHeight: '22px' },
    caption1: { size: '12px', weight: '400', lineHeight: '16px' },
  };
  var nameMap = {
    largeTitle: 'largeTitle', title1: 'title1', title2: 'title2', title3: 'title3',
    headline: 'headline', body: 'body', callout: 'callout', subhead: 'subhead',
    footnote: 'footnote', caption1: 'caption1', caption2: 'caption2'
  };
  var key = nameMap[name];
  if (key && scale[key]) return scale[key];
  return null;
}

// ═══════════════════════════════════════════════════════════════
// _spaceToken
// ═══════════════════════════════════════════════════════════════

describe('_spaceToken', () => {
  it('converts number to CSS var', () => {
    expect(_spaceToken(0)).toBe('var(--nr-space-0)');
    expect(_spaceToken(1)).toBe('var(--nr-space-1)');
    expect(_spaceToken(4)).toBe('var(--nr-space-4)');
    expect(_spaceToken(8)).toBe('var(--nr-space-8)');
  });

  it('passes through string starting with digit', () => {
    expect(_spaceToken('16px')).toBe('16px');
    expect(_spaceToken('2rem')).toBe('2rem');
  });

  it('passes through other strings', () => {
    expect(_spaceToken('auto')).toBe('auto');
    expect(_spaceToken('var(--custom)')).toBe('var(--custom)');
  });

  it('passes through null/undefined', () => {
    expect(_spaceToken(null)).toBe(null);
    expect(_spaceToken(undefined)).toBe(undefined);
  });
});

// ═══════════════════════════════════════════════════════════════
// _radiusToken
// ═══════════════════════════════════════════════════════════════

describe('_radiusToken', () => {
  it('converts known sizes to CSS var', () => {
    expect(_radiusToken('xs')).toBe('var(--nr-radius-xs)');
    expect(_radiusToken('sm')).toBe('var(--nr-radius-sm)');
    expect(_radiusToken('md')).toBe('var(--nr-radius-md)');
    expect(_radiusToken('lg')).toBe('var(--nr-radius-lg)');
    expect(_radiusToken('xl')).toBe('var(--nr-radius-xl)');
    expect(_radiusToken('2xl')).toBe('var(--nr-radius-2xl)');
    expect(_radiusToken('full')).toBe('var(--nr-radius-full)');
  });

  it('passes through unknown values', () => {
    expect(_radiusToken('10px')).toBe('10px');
    expect(_radiusToken('50%')).toBe('50%');
    expect(_radiusToken('none')).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════
// _colorToken
// ═══════════════════════════════════════════════════════════════

describe('_colorToken', () => {
  it('maps semantic names to CSS vars', () => {
    expect(_colorToken('surface')).toBe('var(--nr-bg-surface)');
    expect(_colorToken('body')).toBe('var(--nr-bg-body)');
    expect(_colorToken('raised')).toBe('var(--nr-bg-raised)');
    expect(_colorToken('overlay')).toBe('var(--nr-bg-overlay)');
    expect(_colorToken('primary')).toBe('var(--nr-text-primary)');
    expect(_colorToken('secondary')).toBe('var(--nr-text-secondary)');
    expect(_colorToken('link')).toBe('var(--nr-text-link)');
    expect(_colorToken('accent')).toBe('var(--nr-accent)');
    expect(_colorToken('border-default')).toBe('var(--nr-border-default)');
  });

  it('passes through hex colors', () => {
    expect(_colorToken('#ff0000')).toBe('#ff0000');
    expect(_colorToken('#abc')).toBe('#abc');
  });

  it('passes through rgb/hsl', () => {
    expect(_colorToken('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
    expect(_colorToken('hsl(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
  });

  it('passes through var() expressions', () => {
    expect(_colorToken('var(--my-custom-color)')).toBe('var(--my-custom-color)');
  });

  it('wraps bare custom property names', () => {
    expect(_colorToken('--my-color')).toBe('var(--my-color)');
    expect(_colorToken('--nr-accent')).toBe('var(--nr-accent)');
  });

  it('passes through unknown names', () => {
    expect(_colorToken('banana')).toBe('banana');
    expect(_colorToken('transparent')).toBe('transparent');
  });

  it('returns falsy values as-is', () => {
    expect(_colorToken(null)).toBe(null);
    expect(_colorToken(undefined)).toBe(undefined);
    expect(_colorToken('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// _fontToken
// ═══════════════════════════════════════════════════════════════

describe('_fontToken', () => {
  it('returns scale object for known names', () => {
    const body = _fontToken('body');
    expect(body).not.toBeNull();
    expect(body.size).toBeDefined();
    expect(body.weight).toBeDefined();
    expect(body.lineHeight).toBeDefined();
  });

  it('returns scale object for largeTitle', () => {
    const lt = _fontToken('largeTitle');
    expect(lt).not.toBeNull();
    expect(lt.size).toBeDefined();
  });

  it('returns null for unknown names', () => {
    expect(_fontToken('unknown')).toBeNull();
    expect(_fontToken('nonexistent')).toBeNull();
  });

  it('returns null for empty/null', () => {
    expect(_fontToken(null)).toBeNull();
    expect(_fontToken(undefined)).toBeNull();
    expect(_fontToken('')).toBeNull();
  });
});
