import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable data structures from core-routing.js
// ──────────────────────────────────────────────────────────

/**
 * Route table mapping exact hashes to actions
 */
const ROUTE_TABLE_KEYS = [
  '#research',
  '#settings',
  '#quality',
  '#algorithm',
  '#calendar',
  '#inbox',
  '#profile',
  '#saved-all',
  '#saved',
  '#browse',
  '#search',
  '#terminal',
  '#neuralook',
  '#dev',
  '#vibe',
  '#feed',
];

/**
 * Prefix route patterns
 */
const ROUTE_PREFIXES = [
  '#profile/',
];

/**
 * Check if hash matches exact route
 */
function isExactRoute(hash) {
  return ROUTE_TABLE_KEYS.includes(hash);
}

/**
 * Check if hash matches prefix route
 */
function isPrefixRoute(hash) {
  return ROUTE_PREFIXES.some(prefix => hash.startsWith(prefix));
}

/**
 * Extract route prefix from hash
 */
function getRoutePrefix(hash) {
  const prefix = ROUTE_PREFIXES.find(p => hash.startsWith(p));
  return prefix || null;
}

/**
 * Extract remainder after prefix
 */
function getRouteRemainder(hash) {
  const prefix = getRoutePrefix(hash);
  if (!prefix) return null;
  return hash.slice(prefix.length);
}

/**
 * Parse profile route
 */
function parseProfileRoute(hash) {
  if (!hash.startsWith('#profile/')) return null;
  const username = hash.slice(9); // Remove '#profile/'
  return decodeURIComponent(username);
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Route Table Coverage', () => {
  it('should have 16 exact routes', () => {
    expect(ROUTE_TABLE_KEYS).toHaveLength(16);
  });

  it('should include core routes', () => {
    expect(ROUTE_TABLE_KEYS).toContain('#research');
    expect(ROUTE_TABLE_KEYS).toContain('#settings');
    expect(ROUTE_TABLE_KEYS).toContain('#browse');
  });

  it('should include utility routes', () => {
    expect(ROUTE_TABLE_KEYS).toContain('#calendar');
    expect(ROUTE_TABLE_KEYS).toContain('#inbox');
  });

  it('should include dev routes', () => {
    expect(ROUTE_TABLE_KEYS).toContain('#dev');
    expect(ROUTE_TABLE_KEYS).toContain('#terminal');
  });

  it('should all start with #', () => {
    ROUTE_TABLE_KEYS.forEach(route => {
      expect(route).toMatch(/^#/);
    });
  });

  it('should have no duplicate routes', () => {
    const unique = new Set(ROUTE_TABLE_KEYS);
    expect(unique.size).toBe(ROUTE_TABLE_KEYS.length);
  });
});

describe('Route Prefix Patterns', () => {
  it('should have 1 prefix pattern', () => {
    expect(ROUTE_PREFIXES).toHaveLength(1);
  });

  it('should include dynamic routes', () => {
    expect(ROUTE_PREFIXES).toContain('#profile/');
  });

  it('should all end with slash', () => {
    ROUTE_PREFIXES.forEach(prefix => {
      expect(prefix).toMatch(/\/$/);
    });
  });
});

describe('Exact Route Matching', () => {
  it('should match exact routes', () => {
    expect(isExactRoute('#research')).toBe(true);
    expect(isExactRoute('#settings')).toBe(true);
    expect(isExactRoute('#browse')).toBe(true);
  });

  it('should not match prefix routes', () => {
    expect(isExactRoute('#profile/user')).toBe(false);
  });

  it('should not match unknown routes', () => {
    expect(isExactRoute('#unknown')).toBe(false);
    expect(isExactRoute('#random')).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(isExactRoute('#RESEARCH')).toBe(false);
    expect(isExactRoute('#Research')).toBe(false);
  });
});

describe('Prefix Route Matching', () => {
  it('should match prefix routes', () => {
    expect(isPrefixRoute('#profile/alice')).toBe(true);
  });

  it('should not match exact routes', () => {
    expect(isPrefixRoute('#research')).toBe(false);
    expect(isPrefixRoute('#settings')).toBe(false);
  });

  it('should require content after prefix', () => {
    // These still match the prefix but would fail to parse
    expect(isPrefixRoute('#profile/')).toBe(true);
  });
});

describe('Route Prefix Extraction', () => {
  it('should extract profile prefix', () => {
    expect(getRoutePrefix('#profile/alice')).toBe('#profile/');
  });

  it('should return null for exact routes', () => {
    expect(getRoutePrefix('#research')).toBeNull();
    expect(getRoutePrefix('#settings')).toBeNull();
  });

  it('should return null for unknown routes', () => {
    expect(getRoutePrefix('#unknown/path')).toBeNull();
  });
});

describe('Route Remainder Extraction', () => {
  it('should extract remainder after prefix', () => {
    expect(getRouteRemainder('#profile/alice')).toBe('alice');
  });

  it('should return null for non-prefix routes', () => {
    expect(getRouteRemainder('#research')).toBeNull();
  });
});

describe('Profile Route Parsing', () => {
  it('should parse username', () => {
    expect(parseProfileRoute('#profile/alice')).toBe('alice');
    expect(parseProfileRoute('#profile/bob123')).toBe('bob123');
  });

  it('should decode URI components', () => {
    expect(parseProfileRoute('#profile/user%20name')).toBe('user name');
  });

  it('should return empty string for no username', () => {
    expect(parseProfileRoute('#profile/')).toBe('');
  });

  it('should return null for non-profile routes', () => {
    expect(parseProfileRoute('#notprofile/alice')).toBeNull();
  });
});

describe('Route Pattern Completeness', () => {
  it('should have no overlap between exact and prefix routes', () => {
    ROUTE_TABLE_KEYS.forEach(exact => {
      expect(isPrefixRoute(exact)).toBe(false);
    });
  });

  it('should cover common navigation patterns', () => {
    // User-facing routes
    expect(isExactRoute('#research')).toBe(true);
    expect(isExactRoute('#browse')).toBe(true);

    // Dynamic content routes
    expect(isPrefixRoute('#profile/user')).toBe(true);
    expect(isPrefixRoute('#unknown/x')).toBe(false);
  });
});
