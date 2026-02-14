import { getDb } from '../connection.js';

export interface FeedItem {
  id: number;
  source: string;
  title: string;
  link: string;
  authors: string;
  categories: string;
  description: string;
  pub_date: string | null;
  display_date: string;
  arxiv_id: string | null;
  extra: string;
  fetched_at: number;
}

export function getFeedItems(sources: string[], limit = 100): FeedItem[] {
  const db = getDb();
  if (sources.length === 0) return [];
  const placeholders = sources.map(() => '?').join(', ');
  return db.prepare(
    `SELECT * FROM feed_items WHERE source IN (${placeholders}) ORDER BY pub_date DESC LIMIT ?`
  ).all(...sources, limit) as FeedItem[];
}

export function upsertFeedItems(items: Omit<FeedItem, 'id'>[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO feed_items (source, title, link, authors, categories, description, pub_date, display_date, arxiv_id, extra, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      const result = stmt.run(
        item.source, item.title, item.link, item.authors ?? '',
        item.categories ?? '[]', item.description ?? '',
        item.pub_date, item.display_date ?? '', item.arxiv_id,
        item.extra ?? '{}', item.fetched_at
      );
      if (result.changes > 0) inserted++;
    }
  });
  tx();
  return inserted;
}

export function getQualityCache(titleHash: string, promptHash: string): { verdict: string; score: number } | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT verdict, score FROM quality_cache WHERE title_hash = ? AND prompt_hash = ?'
  ).get(titleHash, promptHash) as { verdict: string; score: number } | undefined;
  return row ?? null;
}

export function setQualityCache(titleHash: string, promptHash: string, verdict: string, score: number): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO quality_cache (title_hash, prompt_hash, verdict, score, cached_at) VALUES (?, ?, ?, ?, ?)'
  ).run(titleHash, promptHash, verdict, score, Date.now() / 1000);
}
