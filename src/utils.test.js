import { describe, it, expect, vi } from 'vitest';
import {
  extractSignificantWords,
  calculateSourceAffinity,
  isNewTabClick,
  parseArxivId,
  formatRelativeTime,
  truncate,
  debounce
} from './utils.js';

describe('extractSignificantWords', () => {
  it('should extract words from a simple title', () => {
    const result = extractSignificantWords('Building Better Neural Networks');
    expect(result).toEqual(['building', 'better', 'neural', 'networks']);
  });

  it('should filter out stop words', () => {
    const result = extractSignificantWords('The Best Way to Learn Python');
    expect(result).toEqual(['best', 'way', 'learn', 'python']);
  });

  it('should filter out short words', () => {
    const result = extractSignificantWords('AI is at a new high');
    expect(result).toEqual(['high']);
  });

  it('should handle custom min length', () => {
    const result = extractSignificantWords('AI ML NLP GPT', 2);
    expect(result).toEqual(['ai', 'ml', 'nlp', 'gpt']);
  });

  it('should remove punctuation and special characters', () => {
    const result = extractSignificantWords('Hello, World! Testing #hashtags @mentions');
    expect(result).toEqual(['hello', 'world', 'testing', 'hashtags', 'mentions']);
  });

  it('should handle empty string', () => {
    expect(extractSignificantWords('')).toEqual([]);
  });

  it('should convert to lowercase', () => {
    const result = extractSignificantWords('Machine Learning Research');
    expect(result).toEqual(['machine', 'learning', 'research']);
  });
});

describe('calculateSourceAffinity', () => {
  it('should return 0.5 for sources with < 3 items', () => {
    expect(calculateSourceAffinity({ total: 2, read: 1, saved: 0, rated: 0, hidden: 0 })).toBe(0.5);
    expect(calculateSourceAffinity({ total: 0, read: 0, saved: 0, rated: 0, hidden: 0 })).toBe(0.5);
  });

  it('should calculate engagement score correctly', () => {
    // All read, none saved/rated/hidden: engagement = 10/10 = 1.0
    const result = calculateSourceAffinity({
      total: 10,
      read: 10,
      saved: 0,
      rated: 0,
      hidden: 0
    });
    expect(result).toBe(1.0);
  });

  it('should apply 2x weight to saved items', () => {
    // 5 saved out of 10: engagement = (0 + 5*2 + 0) / 10 = 1.0
    const result = calculateSourceAffinity({
      total: 10,
      read: 0,
      saved: 5,
      rated: 0,
      hidden: 0
    });
    expect(result).toBe(1.0);
  });

  it('should apply 3x weight to rated items', () => {
    // 3 rated out of 10: engagement = (0 + 0 + 3*3) / 10 = 0.9
    const result = calculateSourceAffinity({
      total: 10,
      read: 0,
      saved: 0,
      rated: 3,
      hidden: 0
    });
    expect(result).toBe(0.9);
  });

  it('should apply penalty for hidden items', () => {
    // 10 read, 5 hidden: engagement = 1.0, penalty = 0.25, result = 0.75
    const result = calculateSourceAffinity({
      total: 10,
      read: 10,
      saved: 0,
      rated: 0,
      hidden: 5
    });
    expect(result).toBe(0.75);
  });

  it('should clamp result between 0.1 and 1.0', () => {
    // High hidden count should not go below 0.1
    const low = calculateSourceAffinity({
      total: 10,
      read: 0,
      saved: 0,
      rated: 0,
      hidden: 10
    });
    expect(low).toBeGreaterThanOrEqual(0.1);

    // Can't exceed 1.0
    const high = calculateSourceAffinity({
      total: 10,
      read: 10,
      saved: 10,
      rated: 10,
      hidden: 0
    });
    expect(high).toBeLessThanOrEqual(1.0);
  });

  it('should handle null/undefined counts', () => {
    expect(calculateSourceAffinity(null)).toBe(0.5);
    expect(calculateSourceAffinity(undefined)).toBe(0.5);
  });
});

describe('isNewTabClick', () => {
  it('should return true for metaKey (Mac)', () => {
    expect(isNewTabClick({ metaKey: true })).toBe(true);
  });

  it('should return true for ctrlKey (Windows/Linux)', () => {
    expect(isNewTabClick({ ctrlKey: true })).toBe(true);
  });

  it('should return false for normal click', () => {
    expect(isNewTabClick({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isNewTabClick(null)).toBe(false);
    expect(isNewTabClick(undefined)).toBe(false);
  });
});

describe('parseArxivId', () => {
  it('should parse direct arXiv ID', () => {
    expect(parseArxivId('2301.12345')).toBe('2301.12345');
    expect(parseArxivId('1234.5678')).toBe('1234.5678');
  });

  it('should parse arXiv URL with /abs/', () => {
    expect(parseArxivId('https://arxiv.org/abs/2301.12345')).toBe('2301.12345');
  });

  it('should parse arXiv URL with /pdf/', () => {
    expect(parseArxivId('https://arxiv.org/pdf/2301.12345.pdf')).toBe('2301.12345');
  });

  it('should handle URL with extra params', () => {
    expect(parseArxivId('https://arxiv.org/abs/2301.12345v2')).toBe('2301.12345');
  });

  it('should return null for invalid input', () => {
    expect(parseArxivId('')).toBe(null);
    expect(parseArxivId('not an arxiv id')).toBe(null);
    expect(parseArxivId('https://example.com')).toBe(null);
  });

  it('should handle null/undefined', () => {
    expect(parseArxivId(null)).toBe(null);
    expect(parseArxivId(undefined)).toBe(null);
  });
});

describe('formatRelativeTime', () => {
  it('should return "just now" for recent timestamps', () => {
    const now = Date.now();
    expect(formatRelativeTime(now)).toBe('just now');
    expect(formatRelativeTime(now - 30000)).toBe('just now'); // 30 seconds ago
  });

  it('should format minutes ago', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 2 * 60 * 1000)).toBe('2m ago');
    expect(formatRelativeTime(now - 45 * 60 * 1000)).toBe('45m ago');
  });

  it('should format hours ago', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 2 * 60 * 60 * 1000)).toBe('2h ago');
    expect(formatRelativeTime(now - 12 * 60 * 60 * 1000)).toBe('12h ago');
  });

  it('should format days ago', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago');
    expect(formatRelativeTime(now - 5 * 24 * 60 * 60 * 1000)).toBe('5d ago');
  });

  it('should format weeks ago', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 2 * 7 * 24 * 60 * 60 * 1000)).toBe('2w ago');
  });

  it('should handle Date objects', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('should handle ISO date strings', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });
});

describe('truncate', () => {
  it('should truncate long text', () => {
    expect(truncate('This is a very long title', 10)).toBe('This is a…');
  });

  it('should not truncate short text', () => {
    expect(truncate('Short', 10)).toBe('Short');
  });

  it('should handle exact length', () => {
    expect(truncate('Exactly10!', 10)).toBe('Exactly10!');
  });

  it('should handle empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('should handle null/undefined', () => {
    expect(truncate(null, 10)).toBe('');
    expect(truncate(undefined, 10)).toBe('');
  });
});

describe('debounce', () => {
  it('should debounce function calls', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 150));

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to debounced function', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('arg1', 'arg2');

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should reset timer on subsequent calls', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    await new Promise(resolve => setTimeout(resolve, 60));
    debounced();
    await new Promise(resolve => setTimeout(resolve, 60));

    // Should not have been called yet (timer was reset)
    expect(fn).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
