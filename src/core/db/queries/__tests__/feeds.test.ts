import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const feedItems = new Map<string, any>();
const userData = new Map<string, string>();
let insertedCount = 0;

const mockDb = {
  prepare: (sql: string) => ({
    get: () => {
      if (sql.includes("key = 'blockedTitles'")) {
        const val = userData.get('blockedTitles');
        return val ? { value: val } : undefined;
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM feed_items')) {
        // Dynamic SQL with IN clause
        const sources = args.slice(0, -1);
        const limit = args[args.length - 1];
        return Array.from(feedItems.values())
          .filter(item => sources.includes(item.source))
          .sort((a, b) => (b.pub_date || '').localeCompare(a.pub_date || ''))
          .slice(0, limit);
      }
      return [];
    },
    run: (...args: any[]) => {
      if (sql.includes('INSERT') && sql.includes('feed_items')) {
        const link = args[2];
        if (!feedItems.has(link)) {
          feedItems.set(link, {
            source: args[0], title: args[1], link: args[2],
            authors: args[3], categories: args[4], description: args[5],
            pub_date: args[6], display_date: args[7], arxiv_id: args[8],
            extra: args[9], fetched_at: args[10],
          });
          insertedCount++;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (sql.includes('INSERT') && sql.includes('user_data')) {
        userData.set('blockedTitles', args[0]);
      }
      return { changes: 0 };
    },
  }),
  transaction: (fn: () => void) => fn,
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { getFeedItems, upsertFeedItems, getBlockedTitles, setBlockedTitles } from '../feeds';

beforeEach(() => {
  feedItems.clear();
  userData.clear();
  insertedCount = 0;
});

describe('feed queries', () => {
  it('getFeedItems returns empty for no sources', () => {
    expect(getFeedItems([], 100)).toEqual([]);
  });

  it('getFeedItems returns items for requested sources', () => {
    feedItems.set('link1', { source: 'arxiv', title: 'Paper', link: 'link1', pub_date: '2024-01-01', categories: '["cs.AI"]', extra: '{}' });
    feedItems.set('link2', { source: 'hn', title: 'HN Post', link: 'link2', pub_date: '2024-01-02', categories: '[]', extra: '{}' });
    const items = getFeedItems(['arxiv'], 100);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Paper');
    // categories should be parsed from JSON string
    expect(items[0].categories).toEqual(['cs.AI']);
  });

  it('upsertFeedItems inserts new items', () => {
    const count = upsertFeedItems([
      { source: 'arxiv', title: 'Test', link: 'link1', authors: '', categories: '[]', description: '', pub_date: '2024-01-01', display_date: '', arxiv_id: '2401.00001', extra: '{}', fetched_at: 1000 },
    ]);
    expect(count).toBe(1);
  });

  it('upsertFeedItems ignores duplicate links', () => {
    const item = { source: 'arxiv', title: 'Test', link: 'link1', authors: '', categories: '[]', description: '', pub_date: '2024-01-01', display_date: '', arxiv_id: '2401.00001', extra: '{}', fetched_at: 1000 };
    upsertFeedItems([item]);
    insertedCount = 0;
    const count = upsertFeedItems([item]);
    expect(count).toBe(0);
  });
});

describe('blocked titles', () => {
  it('getBlockedTitles returns empty array when none set', () => {
    expect(getBlockedTitles()).toEqual([]);
  });

  it('setBlockedTitles persists and getBlockedTitles retrieves', () => {
    setBlockedTitles(['Spam Title', 'Bad Post']);
    expect(getBlockedTitles()).toEqual(['Spam Title', 'Bad Post']);
  });
});
