/**
 * Example: Testing existing quality.js functions
 *
 * This demonstrates how to test vanilla JS global functions
 * from the existing codebase using Vitest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Note: These are simplified versions of the real functions from quality.js
// In a real refactor, you'd either:
// 1. Import the actual functions after converting to ES modules
// 2. Load the script and test global functions
// 3. Extract and test pure logic separately (recommended)

// For now, we'll demonstrate pattern #3 - extracting testable logic

/**
 * Extract words from a title (extracted from quality.js _extractTitleWords)
 */
function extractTitleWords(title, wordMap = {}, weight = 1) {
  const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','it','as','be','was','are','this','that','which','what','how',
    'has','had','have','not','no','do','does','did','will','would','can','could',
    'should','may','might','its','they','their','them','we','our','you','your',
    'he','she','his','her','i','my','me','new','than','more','most','also','just',
    'about','into','over','after','before','between','under','using','via','all',
    'been','being','each','few','some','such','only','other','so','if','then',
    'when','where','why','up','out','who'
  ]);

  const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const w of words) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    wordMap[w] = (wordMap[w] || 0) + weight;
  }
  return wordMap;
}

/**
 * Build interest context string (simplified from quality.js)
 */
function buildInterestContext(profile) {
  if (!profile || !profile.topTopics || !profile.topTopics.length) return '';
  const parts = [];
  if (profile.topTopics.length) {
    parts.push('topics=[' + profile.topTopics.join(', ') + ']');
  }
  if (profile.topCategories && profile.topCategories.length) {
    parts.push('categories=[' + profile.topCategories.join(', ') + ']');
  }
  return parts.join(', ');
}

/**
 * Calculate source affinity (simplified from quality.js)
 */
function calculateAffinity(sourceCounts) {
  const affinity = {};
  for (const [src, c] of Object.entries(sourceCounts)) {
    if (c.total < 3) {
      affinity[src] = 0.5;
      continue;
    }
    const engagement = (c.read + c.saved * 2 + c.rated * 3) / c.total;
    const penalty = (c.hidden / c.total) * 0.5;
    affinity[src] = Math.max(0.1, Math.min(1.0, engagement - penalty));
  }
  return affinity;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Quality Filter Helpers', () => {
  describe('extractTitleWords', () => {
    it('should extract and weight words correctly', () => {
      const wordMap = {};
      extractTitleWords('Machine Learning Research', wordMap, 1);

      expect(wordMap).toEqual({
        machine: 1,
        learning: 1,
        research: 1
      });
    });

    it('should accumulate weights for repeated extraction', () => {
      const wordMap = {};
      extractTitleWords('Deep Learning', wordMap, 1);
      extractTitleWords('Machine Learning', wordMap, 1);

      expect(wordMap.learning).toBe(2);
      expect(wordMap.deep).toBe(1);
      expect(wordMap.machine).toBe(1);
    });

    it('should apply different weights', () => {
      const wordMap = {};
      extractTitleWords('Important Paper', wordMap, 3); // saved
      extractTitleWords('Regular Paper', wordMap, 1);   // read

      expect(wordMap.important).toBe(3);
      expect(wordMap.regular).toBe(1);
      expect(wordMap.paper).toBe(4); // 3 + 1
    });

    it('should filter stop words', () => {
      const wordMap = {};
      extractTitleWords('The Quick Brown Fox Jumps Over The Lazy Dog', wordMap, 1);

      expect(wordMap.the).toBeUndefined();
      expect(wordMap.quick).toBe(1);
      expect(wordMap.brown).toBe(1);
      expect(wordMap.lazy).toBe(1);
    });

    it('should filter short words', () => {
      const wordMap = {};
      extractTitleWords('AI ML NLP Deep Learning', wordMap, 1);

      // AI, ML are too short (< 3 chars)
      expect(wordMap.ai).toBeUndefined();
      expect(wordMap.ml).toBeUndefined();

      // These should be included
      expect(wordMap.nlp).toBe(1);
      expect(wordMap.deep).toBe(1);
      expect(wordMap.learning).toBe(1);
    });
  });

  describe('buildInterestContext', () => {
    it('should build context string from profile', () => {
      const profile = {
        topTopics: ['machine', 'learning', 'neural'],
        topCategories: ['AI & ML', 'Research']
      };

      const context = buildInterestContext(profile);

      expect(context).toBe('topics=[machine, learning, neural], categories=[AI & ML, Research]');
    });

    it('should handle profile with only topics', () => {
      const profile = {
        topTopics: ['python', 'javascript'],
        topCategories: []
      };

      expect(buildInterestContext(profile)).toBe('topics=[python, javascript]');
    });

    it('should return empty string for empty profile', () => {
      expect(buildInterestContext(null)).toBe('');
      expect(buildInterestContext({})).toBe('');
      expect(buildInterestContext({ topTopics: [] })).toBe('');
    });
  });

  describe('calculateAffinity', () => {
    it('should return 0.5 for sources with few items', () => {
      const counts = {
        'source1': { total: 2, read: 1, saved: 0, rated: 0, hidden: 0 }
      };

      const affinity = calculateAffinity(counts);
      expect(affinity.source1).toBe(0.5);
    });

    it('should calculate engagement correctly', () => {
      const counts = {
        'high-engagement': {
          total: 10,
          read: 5,
          saved: 2,   // 2 * 2 = 4
          rated: 1,   // 1 * 3 = 3
          hidden: 0
        }
      };

      const affinity = calculateAffinity(counts);
      // engagement = (5 + 4 + 3) / 10 = 1.2, clamped to 1.0
      expect(affinity['high-engagement']).toBe(1.0);
    });

    it('should apply penalty for hidden items', () => {
      const counts = {
        'some-hidden': {
          total: 10,
          read: 10,
          saved: 0,
          rated: 0,
          hidden: 4
        }
      };

      const affinity = calculateAffinity(counts);
      // engagement = 10/10 = 1.0
      // penalty = (4/10) * 0.5 = 0.2
      // affinity = 1.0 - 0.2 = 0.8
      expect(affinity['some-hidden']).toBe(0.8);
    });

    it('should clamp affinity between 0.1 and 1.0', () => {
      const counts = {
        'all-hidden': {
          total: 10,
          read: 0,
          saved: 0,
          rated: 0,
          hidden: 10
        },
        'super-engaged': {
          total: 10,
          read: 10,
          saved: 10,
          rated: 10,
          hidden: 0
        }
      };

      const affinity = calculateAffinity(counts);
      expect(affinity['all-hidden']).toBeGreaterThanOrEqual(0.1);
      expect(affinity['super-engaged']).toBeLessThanOrEqual(1.0);
    });

    it('should handle multiple sources', () => {
      const counts = {
        'arxiv': { total: 20, read: 15, saved: 5, rated: 2, hidden: 0 },
        'hn': { total: 30, read: 10, saved: 2, rated: 0, hidden: 5 },
        'reddit': { total: 2, read: 1, saved: 0, rated: 0, hidden: 0 }
      };

      const affinity = calculateAffinity(counts);

      expect(affinity.arxiv).toBeGreaterThan(0.8); // High engagement
      expect(affinity.hn).toBeGreaterThan(0.3);    // Medium engagement
      expect(affinity.reddit).toBe(0.5);           // Too few items
    });
  });

  describe('Real-world scenario: Interest profiling', () => {
    it('should build accurate interest profile from user activity', () => {
      // Simulate user reading/saving papers about ML and Python
      const wordMap = {};

      // Read papers
      extractTitleWords('Introduction to Deep Learning', wordMap, 1);
      extractTitleWords('Python Best Practices', wordMap, 1);
      extractTitleWords('Neural Networks Explained', wordMap, 1);

      // Saved papers (3x weight)
      extractTitleWords('Advanced Machine Learning Techniques', wordMap, 3);
      extractTitleWords('Python for Data Science', wordMap, 3);

      // Top words should be learning, python, neural, machine, etc.
      const topWords = Object.entries(wordMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word);

      expect(topWords).toContain('python');
      expect(topWords).toContain('learning');
      expect(wordMap.python).toBe(4); // 1 + 3
      expect(wordMap.learning).toBe(4); // 1 + 3
    });
  });
});
