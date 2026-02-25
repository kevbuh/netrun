import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const refCache = new Map<string, any>();
const authorCache = new Map<string, any>();
const feedback = new Map<number, any>();
const categories = new Map<string, any>();
let feedbackIdCounter = 0;

const mockDb = {
  prepare: (sql: string) => ({
    get: (...args: any[]) => {
      if (sql.includes('FROM reference_cache')) return refCache.get(args[0]);
      if (sql.includes('FROM author_cache')) return authorCache.get(args[0]);
      if (sql.includes('COUNT(*)') && sql.includes("rating = 'good'")) {
        let count = 0;
        for (const f of feedback.values()) if (f.rating === 'good') count++;
        return { count };
      }
      if (sql.includes('COUNT(*)') && sql.includes("rating = 'bad'")) {
        let count = 0;
        for (const f of feedback.values()) if (f.rating === 'bad') count++;
        return { count };
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM annotation_feedback') && sql.includes('rating = ?')) {
        return Array.from(feedback.values())
          .filter(f => f.rating === args[0])
          .sort((a, b) => b.created_at - a.created_at)
          .slice(args[2] ?? 0, (args[2] ?? 0) + (args[1] ?? 100));
      }
      if (sql.includes('FROM annotation_feedback')) {
        return Array.from(feedback.values())
          .sort((a, b) => b.created_at - a.created_at)
          .slice(args[1] ?? 0, (args[1] ?? 0) + (args[0] ?? 100));
      }
      if (sql.includes('FROM annotation_categories')) {
        return Array.from(categories.values()).sort((a, b) => a.created_at - b.created_at);
      }
      return [];
    },
    run: (...args: any[]) => {
      if (sql.includes('INTO reference_cache')) {
        refCache.set(args[0], { references_json: args[1], cached_at: args[2] });
      } else if (sql.includes('INTO author_cache')) {
        authorCache.set(args[0], { author_json: args[1], cached_at: args[2] });
      } else if (sql.includes('INTO annotation_feedback')) {
        const id = ++feedbackIdCounter;
        feedback.set(id, {
          id, url: args[0], page_title: args[1], quote: args[2],
          explanation: args[3], ann_type: args[4], rating: args[5], created_at: args[6],
        });
      } else if (sql.includes('UPDATE annotation_feedback')) {
        const f = feedback.get(args[1]);
        if (f) f.rating = args[0];
      } else if (sql.includes('DELETE FROM annotation_feedback')) {
        feedback.delete(args[0]);
      } else if (sql.includes('INTO annotation_categories')) {
        categories.set(args[0], { key: args[0], name: args[1], description: args[2], color: args[3], created_at: args[4] });
      } else if (sql.includes('DELETE FROM annotation_categories')) {
        categories.delete(args[0]);
      }
    },
  }),
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import {
  getCachedReferences, setCachedReferences,
  getCachedAuthor, setCachedAuthor,
  storeAnnotationFeedback, listAnnotationFeedback, getAnnotationFeedbackStats,
  updateAnnotationFeedbackRating, deleteAnnotationFeedback,
  listAnnotationCategories, addAnnotationCategory, deleteAnnotationCategory,
} from '../content';

beforeEach(() => {
  refCache.clear();
  authorCache.clear();
  feedback.clear();
  categories.clear();
  feedbackIdCounter = 0;
});

describe('reference cache', () => {
  it('getCachedReferences returns null for missing arxiv id', () => {
    expect(getCachedReferences('2401.00001')).toBeNull();
  });

  it('setCachedReferences and getCachedReferences roundtrip', () => {
    const refs = [{ title: 'Paper A' }, { title: 'Paper B' }];
    setCachedReferences('2401.00001', refs);
    expect(getCachedReferences('2401.00001')).toEqual(refs);
  });
});

describe('author cache', () => {
  it('getCachedAuthor returns null data for missing query', () => {
    const result = getCachedAuthor('unknown');
    expect(result.data).toBeNull();
    expect(result.needsRefresh).toBe(false);
  });

  it('setCachedAuthor and getCachedAuthor roundtrip', () => {
    setCachedAuthor('hinton', { name: 'Geoffrey Hinton' });
    const result = getCachedAuthor('hinton');
    expect(result.data).toEqual({ name: 'Geoffrey Hinton' });
    expect(result.needsRefresh).toBe(false); // just cached
  });
});

describe('annotation feedback', () => {
  it('storeAnnotationFeedback creates feedback entry', () => {
    storeAnnotationFeedback('http://page', 'Page Title', 'A quote', 'Explanation', 'INSIGHT', 'good');
    const items = listAnnotationFeedback();
    expect(items.length).toBe(1);
    expect(items[0].rating).toBe('good');
  });

  it('listAnnotationFeedback filters by rating', () => {
    storeAnnotationFeedback('url1', '', 'q1', '', 'INSIGHT', 'good');
    storeAnnotationFeedback('url2', '', 'q2', '', 'AD', 'bad');
    const good = listAnnotationFeedback('good');
    expect(good.length).toBe(1);
    expect(good[0].ann_type).toBe('INSIGHT');
  });

  it('getAnnotationFeedbackStats counts good and bad', () => {
    storeAnnotationFeedback('url1', '', 'q1', '', 'INSIGHT', 'good');
    storeAnnotationFeedback('url2', '', 'q2', '', 'AD', 'good');
    storeAnnotationFeedback('url3', '', 'q3', '', 'AD', 'bad');
    const stats = getAnnotationFeedbackStats();
    expect(stats.good).toBe(2);
    expect(stats.bad).toBe(1);
  });

  it('updateAnnotationFeedbackRating changes rating', () => {
    storeAnnotationFeedback('url', '', 'quote', '', 'INSIGHT', 'good');
    const items = listAnnotationFeedback();
    updateAnnotationFeedbackRating(items[0].id, 'bad');
    expect(feedback.get(items[0].id)!.rating).toBe('bad');
  });

  it('deleteAnnotationFeedback removes entry', () => {
    storeAnnotationFeedback('url', '', 'quote', '', 'INSIGHT', 'good');
    const items = listAnnotationFeedback();
    deleteAnnotationFeedback(items[0].id);
    expect(listAnnotationFeedback().length).toBe(0);
  });
});

describe('annotation categories', () => {
  it('listAnnotationCategories returns empty initially', () => {
    expect(listAnnotationCategories()).toEqual([]);
  });

  it('addAnnotationCategory creates and lists category', () => {
    addAnnotationCategory('BIAS', 'Bias', 'Detects bias', '#ff0000');
    const cats = listAnnotationCategories();
    expect(cats.length).toBe(1);
    expect(cats[0].key).toBe('BIAS');
    expect(cats[0].color).toBe('#ff0000');
  });

  it('deleteAnnotationCategory removes category', () => {
    addAnnotationCategory('BIAS', 'Bias', 'Detects bias', '#ff0000');
    deleteAnnotationCategory('BIAS');
    expect(listAnnotationCategories().length).toBe(0);
  });
});
