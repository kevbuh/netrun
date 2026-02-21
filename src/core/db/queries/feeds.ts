import { getDb, prepare } from '../connection.js';

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

export function getFeedItems(sources: string[], limit = 100): any[] {
  const db = getDb();
  if (sources.length === 0) return [];
  // Dynamic placeholders — can't cache
  const placeholders = sources.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT * FROM feed_items WHERE source IN (${placeholders}) ORDER BY pub_date DESC LIMIT ?`
  ).all(...sources, limit) as FeedItem[];
  return rows.map(row => ({
    ...row,
    categories: parseJsonField(row.categories, []),
    extra: parseJsonField(row.extra, {}),
  }));
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function upsertFeedItems(items: Omit<FeedItem, 'id'>[]): number {
  const db = getDb();
  const stmt = prepare(`
    INSERT INTO feed_items (source, title, link, authors, categories, description, pub_date, display_date, arxiv_id, extra, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, link) DO UPDATE SET
      title = excluded.title, authors = excluded.authors, categories = excluded.categories,
      description = excluded.description, pub_date = excluded.pub_date, display_date = excluded.display_date,
      arxiv_id = excluded.arxiv_id, extra = excluded.extra, fetched_at = excluded.fetched_at
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

export function getSourceFreshness(sources: string[]): Record<string, number> {
  if (sources.length === 0) return {};
  const db = getDb();
  const placeholders = sources.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT source, MAX(fetched_at) as last_fetched FROM feed_items WHERE source IN (${placeholders}) GROUP BY source`
  ).all(...sources) as Array<{ source: string; last_fetched: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) result[row.source] = row.last_fetched;
  return result;
}

// ── Blocked titles (file-based in Python, we use user_data) ──

export function getBlockedTitles(): string[] {
  const row = prepare("SELECT value FROM user_data WHERE google_id = '__global__' AND key = 'blockedTitles'").get() as { value: string } | undefined;
  if (!row) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

export function setBlockedTitles(titles: string[]): void {
  prepare(
    "INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES ('__global__', 'blockedTitles', ?, ?)"
  ).run(JSON.stringify(titles), Date.now() / 1000);
}

