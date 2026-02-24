import { prepare } from '../connection.js';

// ── Reference cache ──

export function getCachedReferences(arxivId: string): unknown[] | null {
  const row = prepare('SELECT references_json FROM reference_cache WHERE arxiv_id = ?').get(arxivId) as { references_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.references_json); } catch { return null; }
}

export function setCachedReferences(arxivId: string, references: unknown[]): void {
  prepare(
    'INSERT OR REPLACE INTO reference_cache (arxiv_id, references_json, cached_at) VALUES (?, ?, ?)'
  ).run(arxivId, JSON.stringify(references), Date.now() / 1000);
}

// ── Author cache ──

export function getCachedAuthor(query: string): { data: unknown; needsRefresh: boolean } {
  const row = prepare('SELECT author_json, cached_at FROM author_cache WHERE query = ?').get(query) as { author_json: string; cached_at: number } | undefined;
  if (!row) return { data: null, needsRefresh: false };
  const data = JSON.parse(row.author_json);
  const age = Date.now() / 1000 - row.cached_at;
  return { data, needsRefresh: age > 86400 }; // refresh daily
}

export function setCachedAuthor(query: string, data: unknown): void {
  prepare(
    'INSERT OR REPLACE INTO author_cache (query, author_json, cached_at) VALUES (?, ?, ?)'
  ).run(query, JSON.stringify(data), Date.now() / 1000);
}

// ── S2 response cache ──

const S2_STALE_SECONDS = 7 * 86400; // 7 days

export function getCachedS2Response(urlPath: string): { data: unknown; isStale: boolean } | null {
  const row = prepare('SELECT response_json, cached_at FROM s2_response_cache WHERE url_path = ?').get(urlPath) as { response_json: string; cached_at: number } | undefined;
  if (!row) return null;
  try {
    const data = JSON.parse(row.response_json);
    const age = Date.now() / 1000 - row.cached_at;
    return { data, isStale: age > S2_STALE_SECONDS };
  } catch { return null; }
}

export function setCachedS2Response(urlPath: string, data: unknown): void {
  prepare(
    'INSERT OR REPLACE INTO s2_response_cache (url_path, response_json, cached_at) VALUES (?, ?, ?)'
  ).run(urlPath, JSON.stringify(data), Date.now() / 1000);
}

export function getS2CacheAge(urlPath: string): number | null {
  const row = prepare('SELECT cached_at FROM s2_response_cache WHERE url_path = ?').get(urlPath) as { cached_at: number } | undefined;
  return row ? row.cached_at : null;
}

export function deleteS2CacheEntry(urlPath: string): void {
  prepare('DELETE FROM s2_response_cache WHERE url_path = ?').run(urlPath);
}

// ── PWC response cache ──

export function getCachedPwcResponse(url: string): { data: unknown; isStale: boolean } | null {
  const row = prepare('SELECT response_json, cached_at FROM pwc_response_cache WHERE url = ?').get(url) as { response_json: string; cached_at: number } | undefined;
  if (!row) return null;
  try {
    const data = JSON.parse(row.response_json);
    const age = Date.now() / 1000 - row.cached_at;
    return { data, isStale: age > S2_STALE_SECONDS };
  } catch { return null; }
}

export function setCachedPwcResponse(url: string, data: unknown): void {
  prepare(
    'INSERT OR REPLACE INTO pwc_response_cache (url, response_json, cached_at) VALUES (?, ?, ?)'
  ).run(url, JSON.stringify(data), Date.now() / 1000);
}

// ── GitHub response cache ──

const GITHUB_STALE_SECONDS = 3 * 86400; // 3 days

export function getCachedGithubResponse(url: string): { data: unknown; isStale: boolean } | null {
  const row = prepare('SELECT response_json, cached_at FROM github_response_cache WHERE url = ?').get(url) as { response_json: string; cached_at: number } | undefined;
  if (!row) return null;
  try {
    const data = JSON.parse(row.response_json);
    const age = Date.now() / 1000 - row.cached_at;
    return { data, isStale: age > GITHUB_STALE_SECONDS };
  } catch { return null; }
}

export function setCachedGithubResponse(url: string, data: unknown): void {
  prepare(
    'INSERT OR REPLACE INTO github_response_cache (url, response_json, cached_at) VALUES (?, ?, ?)'
  ).run(url, JSON.stringify(data), Date.now() / 1000);
}

// ── Annotation feedback ──

export interface AnnotationFeedback {
  id: number;
  url: string;
  page_title: string;
  quote: string;
  explanation: string;
  ann_type: string;
  rating: string;
  created_at: number;
}

export function storeAnnotationFeedback(
  url: string, pageTitle: string, quote: string,
  explanation: string, annType: string, rating: string
): void {
  prepare(
    'INSERT INTO annotation_feedback (url, page_title, quote, explanation, ann_type, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(url || '', pageTitle || '', quote, explanation || '', annType || '', rating, Date.now() / 1000);
}

export function listAnnotationFeedback(rating?: string, limit = 100, offset = 0): AnnotationFeedback[] {
  if (rating) {
    return prepare(
      'SELECT id, url, page_title, quote, explanation, ann_type, rating, created_at FROM annotation_feedback WHERE rating = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(rating, limit, offset) as AnnotationFeedback[];
  }
  return prepare(
    'SELECT id, url, page_title, quote, explanation, ann_type, rating, created_at FROM annotation_feedback ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as AnnotationFeedback[];
}

export function updateAnnotationFeedbackRating(feedbackId: number, rating: string): void {
  prepare('UPDATE annotation_feedback SET rating = ? WHERE id = ?').run(rating, feedbackId);
}

export function deleteAnnotationFeedback(feedbackId: number): void {
  prepare('DELETE FROM annotation_feedback WHERE id = ?').run(feedbackId);
}

export function getAnnotationFeedbackStats(): { good: number; bad: number } {
  const good = (prepare("SELECT COUNT(*) as count FROM annotation_feedback WHERE rating = 'good'").get() as { count: number }).count;
  const bad = (prepare("SELECT COUNT(*) as count FROM annotation_feedback WHERE rating = 'bad'").get() as { count: number }).count;
  return { good, bad };
}

// ── Annotation categories ──

export interface AnnotationCategory {
  key: string;
  name: string;
  description: string;
  color: string;
  created_at: number;
}

export function listAnnotationCategories(): AnnotationCategory[] {
  return prepare(
    'SELECT key, name, description, color, created_at FROM annotation_categories ORDER BY created_at'
  ).all() as AnnotationCategory[];
}

export function addAnnotationCategory(key: string, name: string, description: string, color: string): void {
  prepare(
    'INSERT OR REPLACE INTO annotation_categories (key, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(key, name, description, color || '#888888', Date.now() / 1000);
}

export function deleteAnnotationCategory(key: string): void {
  prepare('DELETE FROM annotation_categories WHERE key = ?').run(key);
}
