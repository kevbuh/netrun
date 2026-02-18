import { describe, it, expect, beforeEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from core-sidebar.js
// ──────────────────────────────────────────────────────────

/**
 * Default sidebar icon order
 */
const SIDEBAR_ICON_IDS = [
  'sb-dashboard',
  'sb-home',
  'sb-browse',
  'sb-neuralook',
  'sb-dev',
  'sb-settings'
];

/**
 * Parse hidden sidebar icons from storage
 */
function parseHiddenIcons(storageValue) {
  if (!storageValue) return [];
  try {
    const parsed = JSON.parse(storageValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * Parse sidebar order from storage
 */
function parseSidebarOrder(storageValue) {
  if (!storageValue) return null;
  try {
    const parsed = JSON.parse(storageValue);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Merge saved order with default icons (add new icons not in saved)
 */
function mergeSidebarOrder(savedOrder, defaultIds) {
  if (!savedOrder || !Array.isArray(savedOrder)) {
    return [...defaultIds];
  }

  // Filter saved order to only include valid icons
  const validSaved = savedOrder.filter(id => defaultIds.includes(id));

  // Add any new icons not in saved order
  const newIcons = defaultIds.filter(id => !validSaved.includes(id));

  return [...validSaved, ...newIcons];
}

/**
 * Check if icon should be hidden
 */
function isIconHidden(iconId, hiddenList) {
  return hiddenList.includes(iconId);
}

/**
 * Serialize sidebar order for storage
 */
function serializeSidebarOrder(order) {
  return JSON.stringify(order);
}

/**
 * Validate sidebar order (all IDs must be unique)
 */
function validateSidebarOrder(order) {
  if (!Array.isArray(order)) return false;
  const unique = new Set(order);
  return unique.size === order.length;
}

/**
 * Get display style for icon
 */
function getIconDisplayStyle(iconId, hiddenList) {
  return isIconHidden(iconId, hiddenList) ? 'none' : '';
}

/**
 * Filter order to remove invalid icons
 */
function filterValidIcons(order, validIds) {
  return order.filter(id => validIds.includes(id));
}

/**
 * Reorder array by moving item from one index to another
 */
function reorderArray(arr, fromIndex, toIndex) {
  const result = [...arr];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Sidebar Icon Constants', () => {
  it('should have 6 default icons', () => {
    expect(SIDEBAR_ICON_IDS).toHaveLength(6);
  });

  it('should include core navigation icons', () => {
    expect(SIDEBAR_ICON_IDS).toContain('sb-dashboard');
    expect(SIDEBAR_ICON_IDS).toContain('sb-home');
    expect(SIDEBAR_ICON_IDS).toContain('sb-browse');
  });

  it('should include settings icon', () => {
    expect(SIDEBAR_ICON_IDS).toContain('sb-settings');
  });

  it('should have unique IDs', () => {
    const unique = new Set(SIDEBAR_ICON_IDS);
    expect(unique.size).toBe(SIDEBAR_ICON_IDS.length);
  });

  it('should all start with "sb-" prefix', () => {
    SIDEBAR_ICON_IDS.forEach(id => {
      expect(id).toMatch(/^sb-/);
    });
  });
});

describe('Hidden Icons Parsing', () => {
  it('should parse valid JSON array', () => {
    const json = JSON.stringify(['sb-dev', 'sb-browse']);
    expect(parseHiddenIcons(json)).toEqual(['sb-dev', 'sb-browse']);
  });

  it('should return empty array for null', () => {
    expect(parseHiddenIcons(null)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseHiddenIcons('')).toEqual([]);
  });

  it('should return empty array for invalid JSON', () => {
    expect(parseHiddenIcons('{')).toEqual([]);
    expect(parseHiddenIcons('not json')).toEqual([]);
  });

  it('should return empty array for non-array JSON', () => {
    expect(parseHiddenIcons('{}')).toEqual([]);
    expect(parseHiddenIcons('123')).toEqual([]);
  });

  it('should handle empty array', () => {
    expect(parseHiddenIcons('[]')).toEqual([]);
  });
});

describe('Sidebar Order Parsing', () => {
  it('should parse valid order', () => {
    const json = JSON.stringify(['sb-dev', 'sb-home', 'sb-dashboard']);
    expect(parseSidebarOrder(json)).toEqual(['sb-dev', 'sb-home', 'sb-dashboard']);
  });

  it('should return null for empty array', () => {
    expect(parseSidebarOrder('[]')).toBeNull();
  });

  it('should return null for null', () => {
    expect(parseSidebarOrder(null)).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    expect(parseSidebarOrder('invalid')).toBeNull();
  });

  it('should return null for non-array', () => {
    expect(parseSidebarOrder('{}')).toBeNull();
  });
});

describe('Sidebar Order Merging', () => {
  it('should use default order when no saved order', () => {
    const result = mergeSidebarOrder(null, SIDEBAR_ICON_IDS);
    expect(result).toEqual(SIDEBAR_ICON_IDS);
  });

  it('should preserve saved order', () => {
    const saved = ['sb-browse', 'sb-dev', 'sb-home'];
    const result = mergeSidebarOrder(saved, SIDEBAR_ICON_IDS);
    expect(result.slice(0, 3)).toEqual(saved);
  });

  it('should add new icons not in saved order', () => {
    const saved = ['sb-home', 'sb-dev'];
    const result = mergeSidebarOrder(saved, SIDEBAR_ICON_IDS);
    expect(result.length).toBe(SIDEBAR_ICON_IDS.length);
    expect(result.slice(0, 2)).toEqual(saved);
  });

  it('should filter out invalid icons from saved order', () => {
    const saved = ['sb-home', 'sb-invalid', 'sb-dev'];
    const result = mergeSidebarOrder(saved, SIDEBAR_ICON_IDS);
    expect(result).not.toContain('sb-invalid');
  });

  it('should handle all icons in custom order', () => {
    const saved = ['sb-settings', 'sb-dashboard', 'sb-home', 'sb-browse', 'sb-neuralook', 'sb-dev'];
    const result = mergeSidebarOrder(saved, SIDEBAR_ICON_IDS);
    expect(result).toEqual(saved);
  });

  it('should append new icon when added to app', () => {
    const saved = ['sb-home', 'sb-dev'];
    const newDefaults = [...SIDEBAR_ICON_IDS, 'sb-new-feature'];
    const result = mergeSidebarOrder(saved, newDefaults);
    expect(result[result.length - 1]).toBe('sb-new-feature');
  });
});

describe('Icon Hidden Check', () => {
  it('should return true when icon is hidden', () => {
    expect(isIconHidden('sb-dev', ['sb-dev', 'sb-browse'])).toBe(true);
  });

  it('should return false when icon is not hidden', () => {
    expect(isIconHidden('sb-home', ['sb-dev', 'sb-browse'])).toBe(false);
  });

  it('should return false for empty hidden list', () => {
    expect(isIconHidden('sb-home', [])).toBe(false);
  });

  it('should be case sensitive', () => {
    expect(isIconHidden('sb-dev', ['SB-DEV'])).toBe(false);
  });
});

describe('Sidebar Order Serialization', () => {
  it('should serialize order to JSON', () => {
    const order = ['sb-home', 'sb-dev', 'sb-browse'];
    const result = serializeSidebarOrder(order);
    expect(result).toBe(JSON.stringify(order));
  });

  it('should round-trip serialize and parse', () => {
    const original = ['sb-settings', 'sb-dashboard', 'sb-home'];
    const serialized = serializeSidebarOrder(original);
    const parsed = parseSidebarOrder(serialized);
    expect(parsed).toEqual(original);
  });

  it('should handle empty array', () => {
    expect(serializeSidebarOrder([])).toBe('[]');
  });
});

describe('Sidebar Order Validation', () => {
  it('should validate unique order', () => {
    expect(validateSidebarOrder(['sb-home', 'sb-dev', 'sb-browse'])).toBe(true);
  });

  it('should reject duplicate icons', () => {
    expect(validateSidebarOrder(['sb-home', 'sb-dev', 'sb-home'])).toBe(false);
  });

  it('should reject non-array', () => {
    expect(validateSidebarOrder({})).toBe(false);
    expect(validateSidebarOrder(null)).toBe(false);
  });

  it('should accept empty array', () => {
    expect(validateSidebarOrder([])).toBe(true);
  });

  it('should accept single item', () => {
    expect(validateSidebarOrder(['sb-home'])).toBe(true);
  });
});

describe('Icon Display Style', () => {
  it('should return "none" for hidden icon', () => {
    expect(getIconDisplayStyle('sb-dev', ['sb-dev'])).toBe('none');
  });

  it('should return empty string for visible icon', () => {
    expect(getIconDisplayStyle('sb-home', ['sb-dev'])).toBe('');
  });

  it('should return empty string when no hidden icons', () => {
    expect(getIconDisplayStyle('sb-home', [])).toBe('');
  });
});

describe('Valid Icon Filtering', () => {
  it('should keep only valid icons', () => {
    const order = ['sb-home', 'sb-invalid', 'sb-dev', 'sb-fake'];
    const result = filterValidIcons(order, SIDEBAR_ICON_IDS);
    expect(result).toEqual(['sb-home', 'sb-dev']);
  });

  it('should return empty for no matches', () => {
    const order = ['invalid1', 'invalid2'];
    const result = filterValidIcons(order, SIDEBAR_ICON_IDS);
    expect(result).toEqual([]);
  });

  it('should preserve order of valid icons', () => {
    const order = ['sb-dev', 'sb-home', 'sb-browse'];
    const result = filterValidIcons(order, SIDEBAR_ICON_IDS);
    expect(result).toEqual(order);
  });
});

describe('Array Reordering', () => {
  it('should move item forward', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const result = reorderArray(arr, 3, 1);
    expect(result).toEqual(['a', 'd', 'b', 'c']);
  });

  it('should move item backward', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const result = reorderArray(arr, 1, 3);
    expect(result).toEqual(['a', 'c', 'd', 'b']);
  });

  it('should handle no-op (same position)', () => {
    const arr = ['a', 'b', 'c'];
    const result = reorderArray(arr, 1, 1);
    expect(result).toEqual(arr);
  });

  it('should move to start', () => {
    const arr = ['a', 'b', 'c'];
    const result = reorderArray(arr, 2, 0);
    expect(result).toEqual(['c', 'a', 'b']);
  });

  it('should move to end', () => {
    const arr = ['a', 'b', 'c'];
    const result = reorderArray(arr, 0, 2);
    expect(result).toEqual(['b', 'c', 'a']);
  });

  it('should not mutate original array', () => {
    const arr = ['a', 'b', 'c'];
    const original = [...arr];
    reorderArray(arr, 0, 2);
    expect(arr).toEqual(original);
  });
});

describe('Sidebar Configuration Completeness', () => {
  it('should have proper ID format', () => {
    SIDEBAR_ICON_IDS.forEach(id => {
      expect(id).toMatch(/^sb-[a-z]+$/);
    });
  });

  it('should maintain consistent ordering', () => {
    expect(SIDEBAR_ICON_IDS[0]).toBe('sb-dashboard');
    expect(SIDEBAR_ICON_IDS[SIDEBAR_ICON_IDS.length - 1]).toBe('sb-settings');
  });
});
