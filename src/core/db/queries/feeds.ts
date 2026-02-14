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

export function getFeedItems(sources: string[], limit = 100): any[] {
  const db = getDb();
  if (sources.length === 0) return [];
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

// ── Blocked titles (file-based in Python, we use user_data) ──

export function getBlockedTitles(): string[] {
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_data WHERE google_id = '__global__' AND key = 'blockedTitles'").get() as { value: string } | undefined;
  if (!row) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

export function setBlockedTitles(titles: string[]): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES ('__global__', 'blockedTitles', ?, ?)"
  ).run(JSON.stringify(titles), Date.now() / 1000);
}

// ── Quality prompt (file-based in Python, we use user_data) ──

export function getQualityPrompt(): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_data WHERE google_id = '__global__' AND key = 'qualityPrompt'").get() as { value: string } | undefined;
  if (!row) return null;
  try {
    const val = JSON.parse(row.value);
    return val || null;
  } catch {
    return row.value || null;
  }
}

export function setQualityPrompt(prompt: string | null): void {
  const db = getDb();
  if (!prompt) {
    db.prepare("DELETE FROM user_data WHERE google_id = '__global__' AND key = 'qualityPrompt'").run();
  } else {
    db.prepare(
      "INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES ('__global__', 'qualityPrompt', ?, ?)"
    ).run(JSON.stringify(prompt), Date.now() / 1000);
  }
}
