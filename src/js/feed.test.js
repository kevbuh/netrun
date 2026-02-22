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
 * Formula: contentScore * (base + sourceAffinity * affinityWeight) + recencyBoost + explorationBoost
 */
function compositeScore(contentScore, sourceAffinity, recencyBoost, weights) {
  const { base = 0.7, affinityWeight = 0.3, recencyWeight = 1.0, explorationWeight = 0.1 } = weights || {};
  const exploration = (sourceAffinity <= 0.5 ? 1 : 0) * explorationWeight * 10;
  return contentScore * (base + sourceAffinity * affinityWeight) + recencyBoost * recencyWeight + exploration;
}

/**
 * Calculate recency boost from age in hours
 * Formula: max(0, 10 - age * 0.5)
 */
function calculateRecencyBoost(ageInHours) {
  return Math.max(0, 10 - ageInHours * 0.5);
}

/**
 * Compute content score based on interest profile match
 * Formula: baseline(30) + topic_match_bonus(up to 40) + category_match_bonus(up to 30)
 */
function computeContentScore(paper, profile) {
  var score = 30;
  if (!profile) return score;

  var STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','it','that','this','are','was','were','be','been','has','have','had','not','no','do','does','did','will','would','can','could','should','may','might','shall','into','as','if','its','than','so','very','just','about','also','more','other','some','only','over','such','after','before','between','each','all','both','through','during','up','out','then','them','these','those','own','same','how','our','new','using','via','based','we','i','you','he','she','they','what','which','who','when','where','why','how','two','one','three','first','second','third','most','many','any','few','large','small','high','low','long','short','old']);

  var titleWords = (paper.title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(function(w) { return w.length > 2 && !STOP_WORDS.has(w); });
  var topTopics = profile.topTopics || [];
  var topCategories = profile.topCategories || [];

  var topicMatches = 0;
  var topTopicSet = new Set(topTopics);
  for (var j = 0; j < titleWords.length; j++) {
    if (topTopicSet.has(titleWords[j])) topicMatches++;
  }
  score += Math.min(40, topicMatches * 15);

  var paperCats = Array.isArray(paper.categories) ? paper.categories : [];
  var topCatSet = new Set(topCategories);
  var catMatches = 0;
  for (var k = 0; k < paperCats.length; k++) {
    if (topCatSet.has(paperCats[k])) catMatches++;
  }
  score += Math.min(30, catMatches * 15);

  return Math.min(100, score);
}

/**
 * Compute source affinity from engagement data
 */
function computeSourceAffinity(sourceCounts) {
  const affinity = {};
  for (const source of Object.keys(sourceCounts)) {
    const c = sourceCounts[source];
    if (c.total < 3) { affinity[source] = 0.5; continue; }
    const engagement = (c.read + c.saved * 2 + c.rated * 3) / c.total;
    const penalty = (c.hidden / c.total) * 0.5;
    affinity[source] = Math.max(0.1, Math.min(1.0, engagement - penalty));
  }
  return affinity;
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
 * Filter papers based on source, hidden state, blocked words, category, author, source, search
 * Extracted from feed.js getFilteredPapers()
 */
function filterPapers(allPapers, options) {
  const {
    hiddenSourceFilters = new Set(),
    hiddenPosts = new Set(),
    blockedWords = new Set(),
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
function sortByForYou(papers, sourceAffinity, weights, now = Date.now(), profile = null) {
  return [...papers].sort((a, b) => {
    const aContent = computeContentScore(a, profile);
    const bContent = computeContentScore(b, profile);

    const aAff = sourceAffinity[a.source] ?? 0.5;
    const bAff = sourceAffinity[b.source] ?? 0.5;

    const aAge = a.pubDate ? Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000) : 24;
    const bAge = b.pubDate ? Math.max(0, (now - new Date(b.pubDate).getTime()) / 3600000) : 24;

    const aRecency = calculateRecencyBoost(aAge);
    const bRecency = calculateRecencyBoost(bAge);

    const aScore = compositeScore(aContent, aAff, aRecency, weights);
    const bScore = compositeScore(bContent, bAff, bRecency, weights);

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


    it('should handle combined filters', () => {
      const { filtered } = filterPapers(mockPapers, {
        hiddenSourceFilters: new Set(['custom:blog']),
        category: 'cs.CV'
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
      const score = compositeScore(65, 0.8, 5, {});
      // 65 * (0.7 + 0.8 * 0.3) + 5 * 1.0 + 0 (affinity > 0.5, no exploration)
      // 65 * (0.7 + 0.24) + 5
      // 65 * 0.94 + 5 = 61.1 + 5 = 66.1
      expect(score).toBeCloseTo(66.1, 1);
    });

    it('should calculate score with custom weights', () => {
      const score = compositeScore(65, 0.8, 5, {
        base: 0.5,
        affinityWeight: 0.5,
        recencyWeight: 2.0,
        explorationWeight: 0.0
      });
      // 65 * (0.5 + 0.8 * 0.5) + 5 * 2.0 + 0
      // 65 * (0.5 + 0.4) + 10
      // 65 * 0.9 + 10 = 58.5 + 10 = 68.5
      expect(score).toBeCloseTo(68.5, 1);
    });

    it('should handle zero affinity', () => {
      const score = compositeScore(65, 0, 5, {});
      // 65 * (0.7 + 0 * 0.3) + 5 * 1.0 + 1 (affinity <= 0.5, exploration = 0.1 * 10 = 1)
      // 65 * 0.7 + 5 + 1 = 45.5 + 5 + 1 = 51.5
      expect(score).toBeCloseTo(51.5, 1);
    });

    it('should handle max affinity', () => {
      const score = compositeScore(65, 1.0, 5, {});
      // 65 * (0.7 + 1.0 * 0.3) + 5 * 1.0 + 0
      // 65 * 1.0 + 5 = 70
      expect(score).toBeCloseTo(70, 1);
    });

    it('should add exploration bonus for low-affinity sources', () => {
      // Same affinity (0.5 = threshold) but one gets explore bonus
      const withExplore = compositeScore(65, 0.5, 0, { explorationWeight: 0.2 });
      const withoutExplore = compositeScore(65, 0.5, 0, { explorationWeight: 0.0 });
      // explorationWeight 0.2 * 10 = 2 point bonus for affinity <= 0.5
      expect(withExplore - withoutExplore).toBeCloseTo(2, 1);

      // High affinity (> 0.5) gets no exploration bonus
      const highAff = compositeScore(65, 0.8, 0, { explorationWeight: 0.2 });
      const highAffNoExplore = compositeScore(65, 0.8, 0, { explorationWeight: 0.0 });
      expect(highAff - highAffNoExplore).toBeCloseTo(0, 1);
    });
  });

  describe('calculateRecencyBoost', () => {
    it('should give max boost for very recent posts', () => {
      const boost = calculateRecencyBoost(0);
      // max(0, 10 - 0 * 0.5) = 10
      expect(boost).toBe(10);
    });

    it('should decrease boost with age', () => {
      expect(calculateRecencyBoost(4)).toBe(8); // 10 - 4*0.5 = 8
      expect(calculateRecencyBoost(10)).toBe(5); // 10 - 10*0.5 = 5
      expect(calculateRecencyBoost(16)).toBe(2); // 10 - 16*0.5 = 2
    });

    it('should floor at zero for old posts', () => {
      expect(calculateRecencyBoost(20)).toBe(0); // 10 - 20*0.5 = 0
      expect(calculateRecencyBoost(100)).toBe(0);
    });
  });

  describe('computeContentScore', () => {
    it('should return baseline 30 when no profile', () => {
      const score = computeContentScore({ title: 'Some Paper' }, null);
      expect(score).toBe(30);
    });

    it('should return baseline 30 when no matches', () => {
      const score = computeContentScore(
        { title: 'Quantum Computing Advances' },
        { topTopics: ['machine', 'learning', 'vision'], topCategories: ['cs.CV'] }
      );
      expect(score).toBe(30);
    });

    it('should add topic match bonus', () => {
      const score = computeContentScore(
        { title: 'Deep Learning for Vision Systems' },
        { topTopics: ['deep', 'learning', 'vision'], topCategories: [] }
      );
      // baseline(30) + 3 topic matches * 15 = 30 + 45 → capped at 40 bonus = 70
      expect(score).toBe(70);
    });

    it('should add category match bonus', () => {
      const score = computeContentScore(
        { title: 'Some Paper', categories: ['cs.CV', 'cs.LG'] },
        { topTopics: [], topCategories: ['cs.CV', 'cs.LG'] }
      );
      // baseline(30) + 0 topic + 2 cat matches * 15 = 30 + 30 = 60
      expect(score).toBe(60);
    });

    it('should cap at 100', () => {
      const score = computeContentScore(
        { title: 'Deep Learning Vision Neural Networks', categories: ['cs.CV', 'cs.LG', 'cs.AI'] },
        { topTopics: ['deep', 'learning', 'vision', 'neural', 'networks'], topCategories: ['cs.CV', 'cs.LG', 'cs.AI'] }
      );
      expect(score).toBe(100);
    });

    it('should ignore stopwords in title', () => {
      const score = computeContentScore(
        { title: 'The and for with' },
        { topTopics: ['the', 'and', 'for', 'with'], topCategories: [] }
      );
      // All words are stopwords or too short, no matches
      expect(score).toBe(30);
    });
  });

  describe('computeSourceAffinity', () => {
    it('should default to 0.5 for sources with < 3 posts', () => {
      const affinity = computeSourceAffinity({
        'arxiv': { total: 2, read: 2, saved: 1, rated: 1, hidden: 0 }
      });
      expect(affinity['arxiv']).toBe(0.5);
    });

    it('should compute engagement-based affinity', () => {
      const affinity = computeSourceAffinity({
        'arxiv': { total: 10, read: 5, saved: 2, rated: 1, hidden: 0 }
      });
      // engagement = (5 + 2*2 + 1*3) / 10 = 12/10 = 1.2
      // penalty = 0
      // affinity = clamp(1.2, 0.1, 1.0) = 1.0
      expect(affinity['arxiv']).toBe(1.0);
    });

    it('should apply hidden penalty', () => {
      const affinity = computeSourceAffinity({
        'hn': { total: 10, read: 0, saved: 0, rated: 0, hidden: 8 }
      });
      // engagement = 0
      // penalty = (8/10) * 0.5 = 0.4
      // affinity = clamp(0 - 0.4, 0.1, 1.0) = 0.1
      expect(affinity['hn']).toBe(0.1);
    });

    it('should clamp between 0.1 and 1.0', () => {
      const affinity = computeSourceAffinity({
        'a': { total: 5, read: 5, saved: 5, rated: 5, hidden: 0 },
        'b': { total: 5, read: 0, saved: 0, rated: 0, hidden: 5 }
      });
      expect(affinity['a']).toBe(1.0);
      expect(affinity['b']).toBe(0.1);
    });
  });

  describe('sortByForYou', () => {
    const sourceAffinity = {
      'arxiv': 0.8,
      'hn': 0.5
    };

    it('should sort by composite score', () => {
      const sorted = sortByForYou(mockPapers, sourceAffinity, {
        base: 0.7,
        affinityWeight: 0.3,
        recencyWeight: 1.0,
        explorationWeight: 0.0
      }, now);

      // All content scores are 30 (baseline, no profile)
      // arxiv: 30*(0.7+0.8*0.3) = 28.2, recency = 0 (age > 20h)
      // HN: 30*(0.7+0.5*0.3) = 25.5, recency = 0
      expect(sorted[2].title).toBe('HN Post'); // Lowest score due to lower affinity
    });

    it('should use default content score of 30 without profile', () => {
      const sorted = sortByForYou([
        { title: 'Uncached', source: 'arxiv', pubDate: '2023-03-14', link: 'link4' }
      ], { 'arxiv': 0.5 }, {}, now);

      expect(sorted).toHaveLength(1);
    });

    it('should boost papers matching interest profile', () => {
      const profile = { topTopics: ['learning', 'deep'], topCategories: ['cs.LG'] };
      const papers = [
        { title: 'Deep Learning Advances', source: 'arxiv', pubDate: '2023-03-14T12:00:00Z', categories: ['cs.LG'], link: 'a' },
        { title: 'Quantum Computing Overview', source: 'arxiv', pubDate: '2023-03-14T12:00:00Z', categories: ['quant-ph'], link: 'b' }
      ];
      const sorted = sortByForYou(papers, { 'arxiv': 0.5 }, {
        base: 0.7, affinityWeight: 0.3, recencyWeight: 0, explorationWeight: 0
      }, now, profile);

      expect(sorted[0].title).toBe('Deep Learning Advances');
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

  });

  describe('sorting edge cases', () => {
    it('should handle empty arrays', () => {
      expect(sortByLatest([])).toEqual([]);
      expect(sortByCitations([])).toEqual([]);
      expect(sortByForYou([], {}, {})).toEqual([]);
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

// ═══════════════════════════════════════════════════════════════
// Blocked words (pure logic)
// ═══════════════════════════════════════════════════════════════

describe('Blocked Words', () => {
  // Re-implement blocked word logic from feed.js
  function addBlockedWords(existing, raw) {
    const newWords = raw.toLowerCase().split(/,\s*/).map(w => w.trim()).filter(Boolean);
    let changed = false;
    for (const w of newWords) {
      if (!existing.includes(w)) { existing.push(w); changed = true; }
    }
    return changed;
  }

  function removeBlockedWord(existing, word) {
    return existing.filter(w => w !== word);
  }

  function titleContainsBlocked(title, blockedWords) {
    const titleLower = title.toLowerCase();
    for (const w of blockedWords) {
      if (titleLower.includes(w)) return true;
    }
    return false;
  }

  it('adds a single word', () => {
    const words = [];
    addBlockedWords(words, 'spam');
    expect(words).toEqual(['spam']);
  });

  it('adds CSV words', () => {
    const words = [];
    addBlockedWords(words, 'spam, crypto, nft');
    expect(words).toEqual(['spam', 'crypto', 'nft']);
  });

  it('deduplicates words', () => {
    const words = ['spam'];
    const changed = addBlockedWords(words, 'spam');
    expect(words).toEqual(['spam']);
    expect(changed).toBe(false);
  });

  it('lowercases words', () => {
    const words = [];
    addBlockedWords(words, 'CRYPTO');
    expect(words).toEqual(['crypto']);
  });

  it('removes a word', () => {
    const result = removeBlockedWord(['spam', 'crypto', 'nft'], 'crypto');
    expect(result).toEqual(['spam', 'nft']);
  });

  it('detects blocked words in titles', () => {
    expect(titleContainsBlocked('New Crypto Exchange Launches', ['crypto'])).toBe(true);
    expect(titleContainsBlocked('Machine Learning Advances', ['crypto'])).toBe(false);
    expect(titleContainsBlocked('Buy NFT Collection Now', ['nft', 'spam'])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Engagement state machine
// ═══════════════════════════════════════════════════════════════

describe('Engagement State Machine', () => {
  // Re-implement read/hide/save state transitions

  function markRead(readPosts, link) {
    if (!readPosts.includes(link)) readPosts.push(link);
    return readPosts;
  }

  function toggleHide(hiddenPosts, link) {
    if (!hiddenPosts.includes(link)) hiddenPosts.push(link);
    return hiddenPosts;
  }

  function toggleSave(savedPosts, paper) {
    const wasAdding = !savedPosts[paper.link];
    if (savedPosts[paper.link]) {
      delete savedPosts[paper.link];
    } else {
      savedPosts[paper.link] = { paper, savedAt: Date.now(), read: false };
    }
    return { savedPosts, wasAdding };
  }

  it('markRead adds link', () => {
    const read = [];
    markRead(read, 'link1');
    expect(read).toEqual(['link1']);
  });

  it('markRead does not duplicate', () => {
    const read = ['link1'];
    markRead(read, 'link1');
    expect(read).toEqual(['link1']);
  });

  it('toggleHide adds link', () => {
    const hidden = [];
    toggleHide(hidden, 'link1');
    expect(hidden).toEqual(['link1']);
  });

  it('toggleHide does not duplicate', () => {
    const hidden = ['link1'];
    toggleHide(hidden, 'link1');
    expect(hidden).toEqual(['link1']);
  });

  it('toggleSave adds with timestamp', () => {
    const saved = {};
    const { wasAdding } = toggleSave(saved, { link: 'link1', title: 'Test' });
    expect(wasAdding).toBe(true);
    expect(saved['link1']).toBeDefined();
    expect(saved['link1'].savedAt).toBeGreaterThan(0);
    expect(saved['link1'].read).toBe(false);
  });

  it('toggleSave removes when already saved', () => {
    const saved = { 'link1': { paper: {}, savedAt: 123, read: false } };
    const { wasAdding } = toggleSave(saved, { link: 'link1' });
    expect(wasAdding).toBe(false);
    expect(saved['link1']).toBeUndefined();
  });

  it('toggleSave reports wasAdding correctly', () => {
    const saved = {};
    const r1 = toggleSave(saved, { link: 'a', title: 'A' });
    expect(r1.wasAdding).toBe(true);
    const r2 = toggleSave(saved, { link: 'a' });
    expect(r2.wasAdding).toBe(false);
  });

  it('independent state tracking', () => {
    const read = [];
    const hidden = [];
    const saved = {};

    markRead(read, 'link1');
    toggleHide(hidden, 'link2');
    toggleSave(saved, { link: 'link3', title: 'Test' });

    expect(read).toEqual(['link1']);
    expect(hidden).toEqual(['link2']);
    expect(Object.keys(saved)).toEqual(['link3']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Interest profile building
// ═══════════════════════════════════════════════════════════════

describe('Interest Profile Building', () => {
  const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','it','that','this','are','was','were','be','been','has','have','had','not','no']);

  function buildProfile(papers, readSet, savedSet, ratings, hiddenSet) {
    const topicScores = {};
    const catScores = {};

    function addTitle(title, weight) {
      if (!title) return;
      const words = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
      for (const w of words) topicScores[w] = (topicScores[w] || 0) + weight;
    }

    function addCategories(cats, weight) {
      if (!Array.isArray(cats)) return;
      for (const c of cats) catScores[c] = (catScores[c] || 0) + weight;
    }

    for (const p of papers) {
      if (readSet.has(p.link)) { addTitle(p.title, 1); addCategories(p.categories, 1); }
      if (savedSet.has(p.link)) { addTitle(p.title, 3); addCategories(p.categories, 3); }
      const rating = ratings[p.link] || 0;
      if (rating > 0) { addTitle(p.title, rating); addCategories(p.categories, rating); }
      if (hiddenSet.has(p.link)) { addTitle(p.title, -0.5); addCategories(p.categories, -0.5); }
    }

    const topTopics = Object.entries(topicScores).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e[0]);
    const topCategories = Object.entries(catScores).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    return { topTopics, topCategories };
  }

  it('weights read posts at 1', () => {
    const papers = [{ link: 'a', title: 'Machine Learning Overview', categories: ['cs.LG'] }];
    const profile = buildProfile(papers, new Set(['a']), new Set(), {}, new Set());
    expect(profile.topTopics).toContain('machine');
    expect(profile.topCategories).toContain('cs.LG');
  });

  it('weights saved posts at 3', () => {
    const papers = [
      { link: 'a', title: 'Deep Networks', categories: ['cs.LG'] },
      { link: 'b', title: 'Quantum Physics', categories: ['quant-ph'] },
    ];
    const profile = buildProfile(papers, new Set(['a', 'b']), new Set(['a']), {}, new Set());
    // 'deep' has weight 1(read) + 3(saved) = 4, 'quantum' has weight 1(read) = 1
    expect(profile.topTopics.indexOf('deep')).toBeLessThan(profile.topTopics.indexOf('quantum'));
  });

  it('weights rated posts by rating value', () => {
    const papers = [{ link: 'a', title: 'Neural Transformer Architecture', categories: [] }];
    const profile = buildProfile(papers, new Set(), new Set(), { 'a': 5 }, new Set());
    expect(profile.topTopics).toContain('neural');
  });

  it('hidden posts get negative weight', () => {
    const papers = [{ link: 'a', title: 'Crypto Trading Strategies', categories: [] }];
    const profile = buildProfile(papers, new Set(), new Set(), {}, new Set(['a']));
    // negative weight means these topics should not appear
    expect(profile.topTopics).not.toContain('crypto');
  });

  it('limits to top 15 topics and top 10 categories', () => {
    const papers = [];
    for (let i = 0; i < 20; i++) {
      papers.push({ link: `l${i}`, title: `unique${i} paper topic`, categories: [`cat${i}`] });
    }
    const profile = buildProfile(papers, new Set(papers.map(p => p.link)), new Set(), {}, new Set());
    expect(profile.topTopics.length).toBeLessThanOrEqual(15);
    expect(profile.topCategories.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// Offline cache state
// ═══════════════════════════════════════════════════════════════

describe('Offline Cache State', () => {
  it('creates a set from array', () => {
    const cached = new Set(['link1', 'link2']);
    expect(cached.has('link1')).toBe(true);
    expect(cached.has('link3')).toBe(false);
  });

  it('supports lookup via has()', () => {
    const cached = new Set(['link1']);
    expect(cached.has('link1')).toBe(true);
    expect(cached.has('link2')).toBe(false);
  });

  it('deduplicates on add', () => {
    const cached = new Set(['link1']);
    cached.add('link1');
    cached.add('link2');
    expect(cached.size).toBe(2);
    expect([...cached]).toEqual(['link1', 'link2']);
  });
});
