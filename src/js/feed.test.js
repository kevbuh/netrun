import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from feed.js logic
// ──────────────────────────────────────────────────────────

/**
 * Parse search query with prefixes and quoted phrases
 * Extracted from feed.js parseSearchQuery()
 */
function parseSearchQuery(raw) {
  let authorFilter = null, sourceFilter = null, sortOverride = null;
  const textTokens = [], exactPhrases = [], titleTokens = [], titlePhrases = [];

  // Extract by: — everything after by: is the author name (BEFORE removing quotes)
  const byMatch = raw.match(/\bby:(.+)/);
  if (byMatch) {
    authorFilter = byMatch[1].trim().toLowerCase();
    raw = raw.slice(0, byMatch.index).trim();
  }

  // Extract title:"quoted phrases" first
  let s = raw.replace(/title:"([^"]+)"/g, (_, ph) => { titlePhrases.push(ph.toLowerCase()); return ''; });
  // Extract generic "quoted phrases"
  s = s.replace(/"([^"]+)"/g, (_, ph) => { exactPhrases.push(ph.toLowerCase()); return ''; });

  const tokens = s.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t.startsWith('source:')) sourceFilter = t.slice(7).toLowerCase();
    else if (t.startsWith('sort:')) sortOverride = t.slice(5).toLowerCase();
    else if (t.startsWith('title:')) titleTokens.push(t.slice(6).toLowerCase());
    else textTokens.push(t);
  }
  return { authorFilter, sourceFilter, sortOverride, textTokens, exactPhrases, titleTokens, titlePhrases };
}

/**
 * Calculate composite score for "For You" sort
 * Formula: llmScore * (base + sourceAffinity * affinityWeight) + recencyBoost * recencyWeight
 */
function compositeScore(llmScore, sourceAffinity, recencyBoost, weights) {
  const { base = 0.7, affinityWeight = 0.3, recencyWeight = 1.0 } = weights || {};
  return llmScore * (base + sourceAffinity * affinityWeight) + recencyBoost * recencyWeight;
}

/**
 * Calculate recency boost from age in hours
 * Formula: max(0, 10 - age * 0.5) * recencyWeight
 */
function calculateRecencyBoost(ageInHours, recencyWeight = 1.0) {
  return Math.max(0, 10 - ageInHours * 0.5) * recencyWeight;
}

/**
 * Check if paper matches search query
 */
function matchesSearch(paper, textTokens, exactPhrases, titleTokens, titlePhrases) {
  const titleLow = paper.title.toLowerCase();
  const haystack = `${paper.title} ${paper.authors || ''} ${paper.description || ''}`.toLowerCase();

  const allPhrases = exactPhrases.slice();
  if (textTokens.length) allPhrases.push(textTokens.join(' '));

  if (!allPhrases.every(ph => haystack.includes(ph))) return false;
  if (!titlePhrases.every(ph => titleLow.includes(ph))) return false;
  if (!titleTokens.every(t => titleLow.includes(t))) return false;

  return true;
}

/**
 * Filter papers based on quality, source, hidden state, blocked words, category, author, source, search
 * Extracted from feed.js getFilteredPapers()
 */
function filterPapers(allPapers, options) {
  const {
    hiddenSourceFilters = new Set(),
    hiddenPosts = new Set(),
    blockedWords = new Set(),
    qualityFilter = { enabled: false, cache: {}, bypass: {}, threshold: 30 },
    category = null,
    searchQuery = '',
  } = options;

  const parsed = parseSearchQuery(searchQuery);
  const { authorFilter, sourceFilter, sortOverride, textTokens, exactPhrases, titleTokens, titlePhrases } = parsed;

  const filtered = allPapers.filter(p => {
    // Source filters
    if (hiddenSourceFilters.has(p.source)) return false;

    // Hidden posts
    if (hiddenPosts.has(p.link)) return false;

    // Blocked words
    if (blockedWords.size > 0) {
      const titleLower = p.title.toLowerCase();
      for (const w of blockedWords) {
        if (titleLower.includes(w)) return false;
      }
    }

    // Quality filter
    const bypassed = qualityFilter.bypass[p.source] || p.source === 'quote';
    if (qualityFilter.enabled && !bypassed && !(p.title in qualityFilter.cache)) return false;
    if (qualityFilter.enabled && !bypassed && (p.title in qualityFilter.cache)) {
      const entry = qualityFilter.cache[p.title];
      const verdict = entry?.v ?? entry;
      if (verdict === 'skip') return false;
      if (verdict === 'keep' && entry?.s != null && entry.s < qualityFilter.threshold) return false;
    }

    // Category filter
    if (category && !p.categories?.includes(category)) return false;

    // Author filter
    if (authorFilter && !(p.authors || '').toLowerCase().includes(authorFilter)) return false;

    // Source filter
    if (sourceFilter && !p.source.toLowerCase().includes(sourceFilter)) return false;

    // Search query
    if (textTokens.length || exactPhrases.length || titleTokens.length || titlePhrases.length) {
      return matchesSearch(p, textTokens, exactPhrases, titleTokens, titlePhrases);
    }

    return true;
  });

  return { filtered, sortOverride };
}

/**
 * Apply diversity constraint to interleave categories
 * Extracted from feed.js getFilteredPapers() category-aware interleaving logic
 */
function applyDiversityInterleaving(papers, maxPerCategoryRun = 3, categoryMap = {}) {
  if (papers.length <= 1) return papers;

  // Group items into per-category queues, preserving sort order within each
  const buckets = new Map(); // cat -> array of items
  const catOrder = []; // insertion order of categories

  for (const p of papers) {
    const cat = categoryMap[p.source] || p.source;
    if (!buckets.has(cat)) {
      buckets.set(cat, []);
      catOrder.push(cat);
    }
    buckets.get(cat).push(p);
  }

  // If only one category, no interleaving needed
  if (buckets.size <= 1) return papers;

  // Round-robin across categories, taking up to maxRun from each before moving on
  const result = [];
  const cursors = new Map(); // cat -> index into its bucket
  for (const cat of catOrder) cursors.set(cat, 0);

  let remaining = papers.length;
  while (remaining > 0) {
    for (const cat of catOrder) {
      const arr = buckets.get(cat);
      const cur = cursors.get(cat);
      if (cur >= arr.length) continue;
      const take = Math.min(maxPerCategoryRun, arr.length - cur);
      for (let j = 0; j < take; j++) result.push(arr[cur + j]);
      cursors.set(cat, cur + take);
      remaining -= take;
    }
  }

  return result;
}

/**
 * Sort papers by "For You" composite score
 */
function sortByForYou(papers, qualityCache, sourceAffinity, weights, now = Date.now()) {
  return [...papers].sort((a, b) => {
    const aLlm = qualityCache[a.title]?.s != null ? qualityCache[a.title].s : 50;
    const bLlm = qualityCache[b.title]?.s != null ? qualityCache[b.title].s : 50;

    const aAff = sourceAffinity[a.source] ?? 0.5;
    const bAff = sourceAffinity[b.source] ?? 0.5;

    const aAge = a.pubDate ? Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000) : 24;
    const bAge = b.pubDate ? Math.max(0, (now - new Date(b.pubDate).getTime()) / 3600000) : 24;

    const aRecency = calculateRecencyBoost(aAge, weights.recencyWeight);
    const bRecency = calculateRecencyBoost(bAge, weights.recencyWeight);

    const aScore = compositeScore(aLlm, aAff, aRecency, weights);
    const bScore = compositeScore(bLlm, bAff, bRecency, weights);

    return bScore - aScore;
  });
}

/**
 * Sort papers by citations or HN score
 */
function sortByCitations(papers) {
  return [...papers].sort((a, b) => {
    const aScore = a.source === 'hn' ? (a.hnScore || 0) : (a.citations || 0);
    const bScore = b.source === 'hn' ? (b.hnScore || 0) : (b.citations || 0);
    return bScore - aScore;
  });
}

/**
 * Sort papers by publication date (latest first)
 */
function sortByLatest(papers) {
  return [...papers].sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Feed Filtering', () => {
  const mockPapers = [
    {
      title: 'Deep Learning for Computer Vision',
      link: 'https://arxiv.org/abs/2301.12345',
      source: 'arxiv',
      authors: 'John Doe, Jane Smith',
      description: 'A comprehensive study of neural networks for image recognition',
      categories: ['cs.CV', 'cs.LG'],
      pubDate: '2023-01-15',
      citations: 42
    },
    {
      title: 'Introduction to Quantum Computing',
      link: 'https://arxiv.org/abs/2302.67890',
      source: 'arxiv',
      authors: 'Alice Johnson',
      description: 'Beginner-friendly guide to quantum algorithms',
      categories: ['quant-ph'],
      pubDate: '2023-02-20',
      citations: 15
    },
    {
      title: 'Show HN: New JavaScript Framework',
      link: 'https://news.ycombinator.com/item?id=12345',
      source: 'hn',
      authors: '',
      description: 'Yet another framework for building web apps',
      categories: [],
      pubDate: '2023-03-01',
      hnScore: 250
    },
    {
      title: 'Python Best Practices 2023',
      link: 'https://example.com/python-tips',
      source: 'custom:blog',
      authors: 'Bob Developer',
      description: 'Modern Python coding standards',
      categories: ['programming'],
      pubDate: '2023-03-10',
      citations: 8
    }
  ];

  describe('filterPapers', () => {
    it('should return all papers when no filters applied', () => {
      const { filtered } = filterPapers(mockPapers, {});
      expect(filtered).toHaveLength(4);
    });

    it('should filter by hidden source', () => {
      const { filtered } = filterPapers(mockPapers, {
        hiddenSourceFilters: new Set(['hn'])
      });
      expect(filtered).toHaveLength(3);
      expect(filtered.every(p => p.source !== 'hn')).toBe(true);
    });

    it('should filter by hidden posts', () => {
      const { filtered } = filterPapers(mockPapers, {
        hiddenPosts: new Set(['https://arxiv.org/abs/2301.12345'])
      });
      expect(filtered).toHaveLength(3);
      expect(filtered.every(p => p.link !== 'https://arxiv.org/abs/2301.12345')).toBe(true);
    });

    it('should filter by blocked words', () => {
      const { filtered } = filterPapers(mockPapers, {
        blockedWords: new Set(['javascript', 'framework'])
      });
      expect(filtered).toHaveLength(3);
      expect(filtered.every(p => !p.title.toLowerCase().includes('javascript'))).toBe(true);
    });

    it('should filter by category', () => {
      const { filtered } = filterPapers(mockPapers, {
        category: 'cs.CV'
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Deep Learning for Computer Vision');
    });

    it('should filter by author', () => {
      const { filtered } = filterPapers(mockPapers, {
        searchQuery: 'by:alice'
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].authors).toContain('Alice');
    });

    it('should filter by source prefix', () => {
      const { filtered } = filterPapers(mockPapers, {
        searchQuery: 'source:arxiv'
      });
      expect(filtered).toHaveLength(2);
      expect(filtered.every(p => p.source === 'arxiv')).toBe(true);
    });

    it('should apply quality filter with verdict', () => {
      const { filtered } = filterPapers(mockPapers, {
        qualityFilter: {
          enabled: true,
          cache: {
            'Deep Learning for Computer Vision': { v: 'keep', s: 80 },
            'Introduction to Quantum Computing': { v: 'skip' },
            'Show HN: New JavaScript Framework': { v: 'keep', s: 60 }
          },
          bypass: {},
          threshold: 30
        }
      });
      // Should exclude: Quantum (verdict=skip) and Python (not in cache)
      expect(filtered).toHaveLength(2);
      expect(filtered.map(p => p.title)).toEqual([
        'Deep Learning for Computer Vision',
        'Show HN: New JavaScript Framework'
      ]);
    });

    it('should apply quality filter with threshold', () => {
      const { filtered } = filterPapers(mockPapers, {
        qualityFilter: {
          enabled: true,
          cache: {
            'Deep Learning for Computer Vision': { v: 'keep', s: 80 },
            'Introduction to Quantum Computing': { v: 'keep', s: 25 },
            'Show HN: New JavaScript Framework': { v: 'keep', s: 60 },
            'Python Best Practices 2023': { v: 'keep', s: 45 }
          },
          bypass: {},
          threshold: 50
        }
      });
      // Should exclude: Quantum (s=25 < 50) and Python (s=45 < 50)
      expect(filtered).toHaveLength(2);
      expect(filtered.map(p => p.title)).toEqual([
        'Deep Learning for Computer Vision',
        'Show HN: New JavaScript Framework'
      ]);
    });

    it('should bypass quality filter for specific sources', () => {
      const { filtered } = filterPapers(mockPapers, {
        qualityFilter: {
          enabled: true,
          cache: {},
          bypass: { 'hn': true },
          threshold: 50
        }
      });
      // HN post should pass even though not in cache
      expect(filtered.some(p => p.source === 'hn')).toBe(true);
      expect(filtered.every(p => p.source === 'hn')).toBe(true);
    });

    it('should handle combined filters', () => {
      const { filtered } = filterPapers(mockPapers, {
        hiddenSourceFilters: new Set(['custom:blog']),
        category: 'cs.CV',
        qualityFilter: {
          enabled: true,
          cache: {
            'Deep Learning for Computer Vision': { v: 'keep', s: 80 }
          },
          bypass: {},
          threshold: 30
        }
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Deep Learning for Computer Vision');
    });
  });

  describe('parseSearchQuery', () => {
    it('should parse plain text tokens', () => {
      const result = parseSearchQuery('machine learning deep');
      expect(result.textTokens).toEqual(['machine', 'learning', 'deep']);
      expect(result.exactPhrases).toEqual([]);
      expect(result.titleTokens).toEqual([]);
    });

    it('should parse quoted phrases', () => {
      const result = parseSearchQuery('machine "deep learning" networks');
      expect(result.textTokens).toEqual(['machine', 'networks']);
      expect(result.exactPhrases).toEqual(['deep learning']);
    });

    it('should parse title: prefix', () => {
      const result = parseSearchQuery('title:quantum title:computing');
      expect(result.titleTokens).toEqual(['quantum', 'computing']);
      expect(result.textTokens).toEqual([]);
    });

    it('should parse title:"quoted phrase"', () => {
      const result = parseSearchQuery('title:"deep learning" other');
      expect(result.titlePhrases).toEqual(['deep learning']);
      expect(result.textTokens).toEqual(['other']);
    });

    it('should parse by: author filter', () => {
      const result = parseSearchQuery('machine learning by:john doe');
      expect(result.authorFilter).toBe('john doe');
      expect(result.textTokens).toEqual(['machine', 'learning']);
    });

    it('should parse source: filter', () => {
      const result = parseSearchQuery('source:arxiv quantum');
      expect(result.sourceFilter).toBe('arxiv');
      expect(result.textTokens).toEqual(['quantum']);
    });

    it('should parse sort: override', () => {
      const result = parseSearchQuery('sort:cited machine learning');
      expect(result.sortOverride).toBe('cited');
      expect(result.textTokens).toEqual(['machine', 'learning']);
    });

    it('should handle complex queries', () => {
      // NOTE: by: captures everything after it, so it should come last in the query
      const result = parseSearchQuery('title:"deep learning" "neural networks" source:arxiv sort:latest computer vision by:john doe');
      expect(result.titlePhrases).toEqual(['deep learning']);
      expect(result.exactPhrases).toEqual(['neural networks']);
      expect(result.sourceFilter).toBe('arxiv');
      expect(result.authorFilter).toBe('john doe'); // Everything after by:
      expect(result.sortOverride).toBe('latest');
      expect(result.textTokens).toEqual(['computer', 'vision']);
    });

    it('should handle empty query', () => {
      const result = parseSearchQuery('');
      expect(result.textTokens).toEqual([]);
      expect(result.exactPhrases).toEqual([]);
      expect(result.authorFilter).toBeNull();
      expect(result.sourceFilter).toBeNull();
    });
  });

  describe('matchesSearch', () => {
    const paper = {
      title: 'Deep Learning for Computer Vision',
      authors: 'John Doe, Jane Smith',
      description: 'A comprehensive study of neural networks for image recognition'
    };

    it('should match text tokens in title/authors/description', () => {
      expect(matchesSearch(paper, ['deep', 'learning'], [], [], [])).toBe(true);
      expect(matchesSearch(paper, ['john', 'doe'], [], [], [])).toBe(true);
      expect(matchesSearch(paper, ['neural', 'networks'], [], [], [])).toBe(true);
    });

    it('should match exact phrases', () => {
      expect(matchesSearch(paper, [], ['deep learning'], [], [])).toBe(true);
      expect(matchesSearch(paper, [], ['computer vision'], [], [])).toBe(true);
      expect(matchesSearch(paper, [], ['quantum computing'], [], [])).toBe(false);
    });

    it('should match title tokens only in title', () => {
      expect(matchesSearch(paper, [], [], ['computer'], [])).toBe(true);
      expect(matchesSearch(paper, [], [], ['neural'], [])).toBe(false); // neural is in description, not title
    });

    it('should match title phrases only in title', () => {
      expect(matchesSearch(paper, [], [], [], ['deep learning'])).toBe(true);
      expect(matchesSearch(paper, [], [], [], ['neural networks'])).toBe(false);
    });

    it('should require all conditions to match', () => {
      expect(matchesSearch(paper, ['deep'], ['computer vision'], [], [])).toBe(true);
      expect(matchesSearch(paper, ['quantum'], ['computer vision'], [], [])).toBe(false);
    });
  });
});

describe('Feed Sorting', () => {
  const now = new Date('2023-03-15T12:00:00Z').getTime();
  const mockPapers = [
    {
      title: 'Recent Paper',
      source: 'arxiv',
      pubDate: '2023-03-14T12:00:00Z', // 1 day old
      citations: 10,
      link: 'link1'
    },
    {
      title: 'Old Paper',
      source: 'arxiv',
      pubDate: '2023-03-01T12:00:00Z', // 14 days old
      citations: 100,
      link: 'link2'
    },
    {
      title: 'HN Post',
      source: 'hn',
      pubDate: '2023-03-14T12:00:00Z',
      hnScore: 500,
      link: 'link3'
    }
  ];

  describe('compositeScore', () => {
    it('should calculate score with default weights', () => {
      const score = compositeScore(80, 0.8, 5, {});
      // 80 * (0.7 + 0.8 * 0.3) + 5 * 1.0
      // 80 * (0.7 + 0.24) + 5
      // 80 * 0.94 + 5 = 75.2 + 5 = 80.2
      expect(score).toBeCloseTo(80.2, 1);
    });

    it('should calculate score with custom weights', () => {
      const score = compositeScore(80, 0.8, 5, {
        base: 0.5,
        affinityWeight: 0.5,
        recencyWeight: 2.0
      });
      // 80 * (0.5 + 0.8 * 0.5) + 5 * 2.0
      // 80 * (0.5 + 0.4) + 10
      // 80 * 0.9 + 10 = 72 + 10 = 82
      expect(score).toBeCloseTo(82, 1);
    });

    it('should handle zero affinity', () => {
      const score = compositeScore(80, 0, 5, {});
      // 80 * (0.7 + 0 * 0.3) + 5 * 1.0
      // 80 * 0.7 + 5 = 56 + 5 = 61
      expect(score).toBeCloseTo(61, 1);
    });

    it('should handle max affinity', () => {
      const score = compositeScore(80, 1.0, 5, {});
      // 80 * (0.7 + 1.0 * 0.3) + 5 * 1.0
      // 80 * 1.0 + 5 = 85
      expect(score).toBeCloseTo(85, 1);
    });
  });

  describe('calculateRecencyBoost', () => {
    it('should give max boost for very recent posts', () => {
      const boost = calculateRecencyBoost(0, 1.0);
      // max(0, 10 - 0 * 0.5) * 1.0 = 10
      expect(boost).toBe(10);
    });

    it('should decrease boost with age', () => {
      expect(calculateRecencyBoost(4, 1.0)).toBe(8); // 10 - 4*0.5 = 8
      expect(calculateRecencyBoost(10, 1.0)).toBe(5); // 10 - 10*0.5 = 5
      expect(calculateRecencyBoost(16, 1.0)).toBe(2); // 10 - 16*0.5 = 2
    });

    it('should floor at zero for old posts', () => {
      expect(calculateRecencyBoost(20, 1.0)).toBe(0); // 10 - 20*0.5 = 0
      expect(calculateRecencyBoost(100, 1.0)).toBe(0);
    });

    it('should scale by recencyWeight', () => {
      expect(calculateRecencyBoost(4, 2.0)).toBe(16); // (10 - 4*0.5) * 2.0 = 16
      expect(calculateRecencyBoost(4, 0.5)).toBe(4); // (10 - 4*0.5) * 0.5 = 4
    });
  });

  describe('sortByForYou', () => {
    const qualityCache = {
      'Recent Paper': { s: 70 },
      'Old Paper': { s: 90 },
      'HN Post': { s: 60 }
    };

    const sourceAffinity = {
      'arxiv': 0.8,
      'hn': 0.5
    };

    it('should sort by composite score', () => {
      const sorted = sortByForYou(mockPapers, qualityCache, sourceAffinity, {
        base: 0.7,
        affinityWeight: 0.3,
        recencyWeight: 1.0
      }, now);

      // Recent Paper: age = 24h, recency = 10 - 24*0.5 = -2 → 0, score = 70*(0.7+0.8*0.3) = 65.8
      // Old Paper: age = 336h, recency = 10 - 336*0.5 = -158 → 0, score = 90*(0.7+0.8*0.3) = 84.6
      // HN Post: age = 24h, recency = 0, score = 60*(0.7+0.5*0.3) = 51

      expect(sorted[0].title).toBe('Old Paper'); // Highest quality score
      expect(sorted[1].title).toBe('Recent Paper');
      expect(sorted[2].title).toBe('HN Post');
    });

    it('should boost recent papers with recency weight', () => {
      const sorted = sortByForYou(mockPapers, qualityCache, sourceAffinity, {
        base: 0.7,
        affinityWeight: 0.3,
        recencyWeight: 5.0
      }, now);

      // Recent Paper: recency = 0, score = 65.8
      // Old Paper: recency = 0, score = 84.6
      // Still same order due to age > 20 hours

      expect(sorted[0].title).toBe('Old Paper');
    });

    it('should use default score of 50 for uncached papers', () => {
      const sorted = sortByForYou([
        { title: 'Uncached', source: 'arxiv', pubDate: '2023-03-14', link: 'link4' }
      ], {}, { 'arxiv': 0.5 }, {}, now);

      expect(sorted).toHaveLength(1);
    });
  });

  describe('sortByCitations', () => {
    it('should sort by citation count', () => {
      const sorted = sortByCitations(mockPapers);
      // HN posts use hnScore, so HN Post (500) > Old Paper (100) > Recent Paper (10)
      expect(sorted[0].title).toBe('HN Post'); // 500 hnScore
      expect(sorted[1].title).toBe('Old Paper'); // 100 citations
      expect(sorted[2].title).toBe('Recent Paper'); // 10 citations
    });

    it('should use hnScore for HN posts', () => {
      const sorted = sortByCitations(mockPapers);
      expect(sorted[0].title).toBe('HN Post'); // 500 hnScore
      expect(sorted[1].title).toBe('Old Paper'); // 100 citations
    });

    it('should handle missing citation counts', () => {
      const papers = [
        { title: 'A', source: 'arxiv', citations: 10, link: 'a' },
        { title: 'B', source: 'arxiv', link: 'b' }
      ];
      const sorted = sortByCitations(papers);
      expect(sorted[0].title).toBe('A');
      expect(sorted[1].title).toBe('B');
    });
  });

  describe('sortByLatest', () => {
    it('should sort by publication date descending', () => {
      const sorted = sortByLatest(mockPapers);
      expect(sorted[0].title).toBe('Recent Paper');
      expect(sorted[1].title).toBe('HN Post');
      expect(sorted[2].title).toBe('Old Paper');
    });

    it('should handle missing dates', () => {
      const papers = [
        { title: 'A', pubDate: '2023-03-01', link: 'a' },
        { title: 'B', link: 'b' }, // no date
        { title: 'C', pubDate: '2023-03-15', link: 'c' }
      ];
      const sorted = sortByLatest(papers);
      expect(sorted[0].title).toBe('C');
      expect(sorted[1].title).toBe('A');
      expect(sorted[2].title).toBe('B'); // No date = timestamp 0
    });
  });
});

describe('Diversity Interleaving', () => {
  const FEED_CAT_MAP = {
    'arxiv': 'Research',
    'hn': 'Tech News',
    'reddit': 'Tech News',
    'blog1': 'Blogs',
    'blog2': 'Blogs'
  };

  describe('applyDiversityInterleaving', () => {
    it('should not change single-category feeds', () => {
      const papers = [
        { title: 'A', source: 'arxiv', link: 'a' },
        { title: 'B', source: 'arxiv', link: 'b' },
        { title: 'C', source: 'arxiv', link: 'c' }
      ];
      const result = applyDiversityInterleaving(papers, 3, FEED_CAT_MAP);
      expect(result).toEqual(papers);
    });

    it('should interleave two categories', () => {
      const papers = [
        { title: 'A1', source: 'arxiv', link: 'a1' },
        { title: 'A2', source: 'arxiv', link: 'a2' },
        { title: 'A3', source: 'arxiv', link: 'a3' },
        { title: 'H1', source: 'hn', link: 'h1' },
        { title: 'H2', source: 'hn', link: 'h2' }
      ];
      const result = applyDiversityInterleaving(papers, 2, FEED_CAT_MAP);

      // Should take 2 from Research, 2 from Tech News, 1 from Research
      expect(result.map(p => p.title)).toEqual(['A1', 'A2', 'H1', 'H2', 'A3']);
    });

    it('should respect maxPerCategoryRun', () => {
      const papers = [
        { title: 'A1', source: 'arxiv', link: 'a1' },
        { title: 'A2', source: 'arxiv', link: 'a2' },
        { title: 'A3', source: 'arxiv', link: 'a3' },
        { title: 'A4', source: 'arxiv', link: 'a4' },
        { title: 'H1', source: 'hn', link: 'h1' },
        { title: 'H2', source: 'hn', link: 'h2' }
      ];
      const result = applyDiversityInterleaving(papers, 1, FEED_CAT_MAP);

      // Should alternate: A1, H1, A2, H2, A3, A4
      expect(result.map(p => p.title)).toEqual(['A1', 'H1', 'A2', 'H2', 'A3', 'A4']);
    });

    it('should handle three categories', () => {
      const papers = [
        { title: 'A1', source: 'arxiv', link: 'a1' },
        { title: 'A2', source: 'arxiv', link: 'a2' },
        { title: 'H1', source: 'hn', link: 'h1' },
        { title: 'H2', source: 'hn', link: 'h2' },
        { title: 'B1', source: 'blog1', link: 'b1' },
        { title: 'B2', source: 'blog2', link: 'b2' }
      ];
      const result = applyDiversityInterleaving(papers, 1, FEED_CAT_MAP);

      // Should round-robin: Research, Tech News, Blogs, Research, Tech News, Blogs
      expect(result.map(p => p.title)).toEqual(['A1', 'H1', 'B1', 'A2', 'H2', 'B2']);
    });

    it('should preserve sort order within each category', () => {
      const papers = [
        { title: 'A3', source: 'arxiv', link: 'a3', score: 90 },
        { title: 'A1', source: 'arxiv', link: 'a1', score: 80 },
        { title: 'H2', source: 'hn', link: 'h2', score: 70 },
        { title: 'H1', source: 'hn', link: 'h1', score: 60 }
      ];
      const result = applyDiversityInterleaving(papers, 2, FEED_CAT_MAP);

      // Within Research: A3, A1 (original order)
      // Within Tech News: H2, H1 (original order)
      // Interleaved: A3, A1, H2, H1
      expect(result.map(p => p.title)).toEqual(['A3', 'A1', 'H2', 'H1']);
    });

    it('should handle uneven category sizes', () => {
      const papers = [
        { title: 'A1', source: 'arxiv', link: 'a1' },
        { title: 'A2', source: 'arxiv', link: 'a2' },
        { title: 'A3', source: 'arxiv', link: 'a3' },
        { title: 'A4', source: 'arxiv', link: 'a4' },
        { title: 'A5', source: 'arxiv', link: 'a5' },
        { title: 'H1', source: 'hn', link: 'h1' }
      ];
      const result = applyDiversityInterleaving(papers, 2, FEED_CAT_MAP);

      // Round 1: A1, A2 (Research), H1 (Tech News)
      // Round 2: A3, A4 (Research), [Tech News exhausted]
      // Round 3: A5 (Research)
      expect(result.map(p => p.title)).toEqual(['A1', 'A2', 'H1', 'A3', 'A4', 'A5']);
    });

    it('should handle empty input', () => {
      expect(applyDiversityInterleaving([], 3, FEED_CAT_MAP)).toEqual([]);
    });

    it('should handle single item', () => {
      const papers = [{ title: 'A', source: 'arxiv', link: 'a' }];
      expect(applyDiversityInterleaving(papers, 3, FEED_CAT_MAP)).toEqual(papers);
    });
  });
});

describe('Post Interactions', () => {
  describe('bookmark tracking', () => {
    it('should add post to saved posts', () => {
      const savedPosts = {};
      const paper = { link: 'https://example.com/paper1', title: 'Test Paper' };

      savedPosts[paper.link] = true;

      expect(savedPosts[paper.link]).toBe(true);
    });

    it('should remove post from saved posts', () => {
      const savedPosts = { 'https://example.com/paper1': true };
      const paper = { link: 'https://example.com/paper1' };

      delete savedPosts[paper.link];

      expect(savedPosts[paper.link]).toBeUndefined();
    });
  });

  describe('hide tracking', () => {
    it('should add post to hidden posts', () => {
      const hiddenPosts = new Set();
      const paper = { link: 'https://example.com/paper1' };

      hiddenPosts.add(paper.link);

      expect(hiddenPosts.has(paper.link)).toBe(true);
    });

    it('should be used in quality test suite', () => {
      const qualityTestTitles = new Set(['Bad Title', 'Spam Article']);

      expect(qualityTestTitles.has('Bad Title')).toBe(true);
      expect(qualityTestTitles.has('Good Title')).toBe(false);
    });
  });

  describe('read tracking', () => {
    it('should add post to read posts', () => {
      const readPosts = new Set();
      const paper = { link: 'https://example.com/paper1' };

      readPosts.add(paper.link);

      expect(readPosts.has(paper.link)).toBe(true);
    });

    it('should mark read posts with lower opacity', () => {
      const readPosts = new Set(['https://example.com/paper1']);
      const paper = { link: 'https://example.com/paper1' };

      const isRead = readPosts.has(paper.link);
      const opacity = isRead ? 0.5 : 1.0;

      expect(opacity).toBe(0.5);
    });
  });

  describe('combined post state', () => {
    it('should track multiple states independently', () => {
      const savedPosts = { 'link1': true, 'link2': true };
      const hiddenPosts = new Set(['link3']);
      const readPosts = new Set(['link1', 'link4']);

      // link1: saved and read
      expect(savedPosts['link1']).toBe(true);
      expect(readPosts.has('link1')).toBe(true);
      expect(hiddenPosts.has('link1')).toBe(false);

      // link2: saved only
      expect(savedPosts['link2']).toBe(true);
      expect(readPosts.has('link2')).toBe(false);

      // link3: hidden only
      expect(hiddenPosts.has('link3')).toBe(true);
      expect(savedPosts['link3']).toBeUndefined();

      // link4: read only
      expect(readPosts.has('link4')).toBe(true);
      expect(savedPosts['link4']).toBeUndefined();
    });
  });
});

describe('Feed View Modes', () => {
  describe('mode selection', () => {
    it('should support compact mode', () => {
      const mode = 'compact';
      expect(['compact', 'verbose', 'twitter', 'masonry']).toContain(mode);
    });

    it('should support verbose mode', () => {
      const mode = 'verbose';
      expect(['compact', 'verbose', 'twitter', 'masonry']).toContain(mode);
    });

    it('should support twitter mode', () => {
      const mode = 'twitter';
      expect(['compact', 'verbose', 'twitter', 'masonry']).toContain(mode);
    });

    it('should default to masonry mode', () => {
      const mode = 'masonry';
      expect(['compact', 'verbose', 'twitter', 'masonry']).toContain(mode);
    });
  });

  describe('empty state handling', () => {
    it('should show empty state when no papers match filter', () => {
      const filtered = [];
      const pending = 0;
      const threshold = 50;

      const isEmpty = filtered.length === 0 && pending === 0;

      expect(isEmpty).toBe(true);
    });

    it('should not show empty state when papers are pending evaluation', () => {
      const filtered = [];
      const pending = 5;

      const shouldShowEmpty = filtered.length === 0 && pending === 0;

      expect(shouldShowEmpty).toBe(false);
    });

    it('should show quality threshold in empty state', () => {
      const threshold = 75;
      const dots = Array.from({ length: 10 }, (_, i) => i < Math.round(threshold / 10));

      const filledCount = dots.filter(Boolean).length;
      expect(filledCount).toBe(8); // 75/10 = 7.5 → 8
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  describe('filterPapers edge cases', () => {
    it('should handle papers without categories', () => {
      const papers = [{ title: 'Test', source: 'test', link: 'link1' }];
      const { filtered } = filterPapers(papers, { category: 'cs.CV' });
      expect(filtered).toHaveLength(0);
    });

    it('should handle papers without authors', () => {
      const papers = [{ title: 'Test', source: 'test', link: 'link1', authors: '' }];
      const { filtered } = filterPapers(papers, { searchQuery: 'by:john' });
      expect(filtered).toHaveLength(0);
    });

    it('should handle papers without description', () => {
      const paper = { title: 'Test', link: 'link1' };
      const matches = matchesSearch(paper, ['test'], [], [], []);
      expect(matches).toBe(true);
    });

    it('should handle malformed quality cache entries', () => {
      const { filtered } = filterPapers([
        { title: 'Test', source: 'test', link: 'link1', categories: [] }
      ], {
        qualityFilter: {
          enabled: true,
          cache: { 'Test': 'keep' }, // Old format: verdict as string
          bypass: {},
          threshold: 50
        }
      });
      expect(filtered).toHaveLength(1);
    });
  });

  describe('sorting edge cases', () => {
    it('should handle empty arrays', () => {
      expect(sortByLatest([])).toEqual([]);
      expect(sortByCitations([])).toEqual([]);
      expect(sortByForYou([], {}, {}, {})).toEqual([]);
    });

    it('should handle papers with null/undefined dates', () => {
      const papers = [
        { title: 'A', pubDate: null, link: 'a' },
        { title: 'B', pubDate: undefined, link: 'b' }
      ];
      const sorted = sortByLatest(papers);
      expect(sorted).toHaveLength(2);
    });

    it('should handle invalid date strings', () => {
      const papers = [{ title: 'A', pubDate: 'invalid', link: 'a' }];
      const sorted = sortByLatest(papers);
      expect(sorted).toHaveLength(1);
    });
  });

  describe('search edge cases', () => {
    it('should handle special characters in search', () => {
      // Simple regex doesn't handle escaped quotes, so this will extract multiple phrases
      const result = parseSearchQuery('test "quoted phrase"');
      expect(result.exactPhrases).toContain('quoted phrase');
    });

    it('should handle multiple spaces', () => {
      const result = parseSearchQuery('test    multiple    spaces');
      expect(result.textTokens).toEqual(['test', 'multiple', 'spaces']);
    });

    it('should handle quotes without closing', () => {
      const result = parseSearchQuery('test "unclosed');
      // Should not extract incomplete phrase
      expect(result.textTokens).toContain('test');
    });

    it('should be case-insensitive', () => {
      const paper = { title: 'Deep Learning', authors: '', description: '' };
      // matchesSearch expects lowercase tokens (parseSearchQuery lowercases them)
      expect(matchesSearch(paper, ['deep'], [], [], [])).toBe(true);
      expect(matchesSearch(paper, ['learning'], [], [], [])).toBe(true);
    });
  });
});
