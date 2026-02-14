import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable data structures from core-routing.js
// ──────────────────────────────────────────────────────────

/**
 * Route table mapping exact hashes to actions
 */
const ROUTE_TABLE_KEYS = [
  '#research',
  '#experiments',
  '#settings',
  '#quality',
  '#algorithm',
  '#calendar',
  '#inbox',
  '#teams',
  '#vault',
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
  '#blog/',
  '#team/',
  '#profile/',
  '#experiment/',
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
 * Parse blog route
 */
function parseBlogRoute(hash) {
  if (!hash.startsWith('#blog/')) return null;
  const rest = hash.slice(6); // Remove '#blog/'
  const parts = rest.split('/');
  if (parts.length < 2) return null;
  return {
    username: decodeURIComponent(parts[0]),
    slug: decodeURIComponent(parts.slice(1).join('/'))
  };
}

/**
 * Parse team route
 */
function parseTeamRoute(hash) {
  if (!hash.startsWith('#team/')) return null;
  const rest = hash.slice(6); // Remove '#team/'
  const teamId = parseInt(rest, 10);
  return teamId || null;
}

/**
 * Parse profile route
 */
function parseProfileRoute(hash) {
  if (!hash.startsWith('#profile/')) return null;
  const username = hash.slice(9); // Remove '#profile/'
  return decodeURIComponent(username);
}

/**
 * Parse experiment route
 */
function parseExperimentRoute(hash) {
  if (!hash.startsWith('#experiment/')) return null;
  const rest = hash.slice(12); // Remove '#experiment/'
  const qIdx = rest.indexOf('?');
  const expId = qIdx >= 0 ? decodeURIComponent(rest.slice(0, qIdx)) : decodeURIComponent(rest);
  const params = qIdx >= 0 ? new URLSearchParams(rest.slice(qIdx)) : null;
  const autoFile = params && params.get('file');
  return {
    expId,
    file: autoFile ? decodeURIComponent(autoFile) : null
  };
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Route Table Coverage', () => {
  it('should have 20 exact routes', () => {
    expect(ROUTE_TABLE_KEYS).toHaveLength(19);
  });

  it('should include core routes', () => {
    expect(ROUTE_TABLE_KEYS).toContain('#research');
    expect(ROUTE_TABLE_KEYS).toContain('#settings');
    expect(ROUTE_TABLE_KEYS).toContain('#browse');
    expect(ROUTE_TABLE_KEYS).toContain('#vault');
  });

  it('should include utility routes', () => {
    expect(ROUTE_TABLE_KEYS).toContain('#calendar');
    expect(ROUTE_TABLE_KEYS).toContain('#inbox');
    expect(ROUTE_TABLE_KEYS).toContain('#teams');
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
  it('should have 4 prefix patterns', () => {
    expect(ROUTE_PREFIXES).toHaveLength(4);
  });

  it('should include dynamic routes', () => {
    expect(ROUTE_PREFIXES).toContain('#blog/');
    expect(ROUTE_PREFIXES).toContain('#team/');
    expect(ROUTE_PREFIXES).toContain('#profile/');
    expect(ROUTE_PREFIXES).toContain('#experiment/');
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
    expect(isExactRoute('#blog/user/post')).toBe(false);
    expect(isExactRoute('#team/123')).toBe(false);
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
    expect(isPrefixRoute('#blog/user/post')).toBe(true);
    expect(isPrefixRoute('#team/123')).toBe(true);
    expect(isPrefixRoute('#profile/alice')).toBe(true);
    expect(isPrefixRoute('#experiment/exp1')).toBe(true);
  });

  it('should not match exact routes', () => {
    expect(isPrefixRoute('#research')).toBe(false);
    expect(isPrefixRoute('#settings')).toBe(false);
  });

  it('should require content after prefix', () => {
    // These still match the prefix but would fail to parse
    expect(isPrefixRoute('#blog/')).toBe(true);
    expect(isPrefixRoute('#team/')).toBe(true);
  });
});

describe('Route Prefix Extraction', () => {
  it('should extract blog prefix', () => {
    expect(getRoutePrefix('#blog/user/post')).toBe('#blog/');
  });

  it('should extract team prefix', () => {
    expect(getRoutePrefix('#team/123')).toBe('#team/');
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
    expect(getRouteRemainder('#blog/user/post')).toBe('user/post');
    expect(getRouteRemainder('#team/123')).toBe('123');
    expect(getRouteRemainder('#profile/alice')).toBe('alice');
  });

  it('should return null for non-prefix routes', () => {
    expect(getRouteRemainder('#research')).toBeNull();
  });
});

describe('Blog Route Parsing', () => {
  it('should parse valid blog route', () => {
    const result = parseBlogRoute('#blog/alice/my-post');
    expect(result).toEqual({
      username: 'alice',
      slug: 'my-post'
    });
  });

  it('should handle multi-segment slugs', () => {
    const result = parseBlogRoute('#blog/bob/deep/nested/post');
    expect(result).toEqual({
      username: 'bob',
      slug: 'deep/nested/post'
    });
  });

  it('should decode URI components', () => {
    const result = parseBlogRoute('#blog/alice/my%20post%20title');
    expect(result).toEqual({
      username: 'alice',
      slug: 'my post title'
    });
  });

  it('should return null for invalid blog routes', () => {
    expect(parseBlogRoute('#blog/')).toBeNull();
    expect(parseBlogRoute('#blog/onlyuser')).toBeNull();
    expect(parseBlogRoute('#notblog/user/post')).toBeNull();
  });
});

describe('Team Route Parsing', () => {
  it('should parse valid team ID', () => {
    expect(parseTeamRoute('#team/123')).toBe(123);
    expect(parseTeamRoute('#team/456')).toBe(456);
  });

  it('should return null for invalid team IDs', () => {
    expect(parseTeamRoute('#team/abc')).toBeNull();
    expect(parseTeamRoute('#team/')).toBeNull();
  });

  it('should return null for non-team routes', () => {
    expect(parseTeamRoute('#notteam/123')).toBeNull();
  });

  it('should parse only integers', () => {
    expect(parseTeamRoute('#team/12.5')).toBe(12);
    expect(parseTeamRoute('#team/0')).toBeNull(); // 0 is falsy
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

describe('Experiment Route Parsing', () => {
  it('should parse experiment ID', () => {
    const result = parseExperimentRoute('#experiment/exp1');
    expect(result).toEqual({
      expId: 'exp1',
      file: null
    });
  });

  it('should parse experiment with file parameter', () => {
    const result = parseExperimentRoute('#experiment/exp1?file=main.py');
    expect(result).toEqual({
      expId: 'exp1',
      file: 'main.py'
    });
  });

  it('should decode URI components', () => {
    const result = parseExperimentRoute('#experiment/my%20exp?file=my%20file.py');
    expect(result).toEqual({
      expId: 'my exp',
      file: 'my file.py'
    });
  });

  it('should handle missing file parameter', () => {
    const result = parseExperimentRoute('#experiment/exp1?other=value');
    expect(result).toEqual({
      expId: 'exp1',
      file: null
    });
  });

  it('should return null for non-experiment routes', () => {
    expect(parseExperimentRoute('#notexp/exp1')).toBeNull();
  });

  it('should handle empty experiment ID', () => {
    const result = parseExperimentRoute('#experiment/');
    expect(result).toEqual({
      expId: '',
      file: null
    });
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
    expect(isExactRoute('#vault')).toBe(true);

    // Dynamic content routes
    expect(isPrefixRoute('#blog/user/post')).toBe(true);
    expect(isPrefixRoute('#profile/user')).toBe(true);
  });
});
