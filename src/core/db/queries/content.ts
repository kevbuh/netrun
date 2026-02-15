import { getDb } from '../connection.js';

// ── Reference cache ──

export function getCachedReferences(arxivId: string): unknown[] | null {
  const db = getDb();
  const row = db.prepare('SELECT references_json FROM reference_cache WHERE arxiv_id = ?').get(arxivId) as { references_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.references_json); } catch { return null; }
}

export function setCachedReferences(arxivId: string, references: unknown[]): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO reference_cache (arxiv_id, references_json, cached_at) VALUES (?, ?, ?)'
  ).run(arxivId, JSON.stringify(references), Date.now() / 1000);
}

// ── Author cache ──

export function getCachedAuthor(query: string): { data: unknown; needsRefresh: boolean } {
  const db = getDb();
  const row = db.prepare('SELECT author_json, cached_at FROM author_cache WHERE query = ?').get(query) as { author_json: string; cached_at: number } | undefined;
  if (!row) return { data: null, needsRefresh: false };
  const data = JSON.parse(row.author_json);
  const age = Date.now() / 1000 - row.cached_at;
  return { data, needsRefresh: age > 86400 }; // refresh daily
}

export function setCachedAuthor(query: string, data: unknown): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO author_cache (query, author_json, cached_at) VALUES (?, ?, ?)'
  ).run(query, JSON.stringify(data), Date.now() / 1000);
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
  const db = getDb();
  db.prepare(
    'INSERT INTO annotation_feedback (url, page_title, quote, explanation, ann_type, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(url || '', pageTitle || '', quote, explanation || '', annType || '', rating, Date.now() / 1000);
}

export function listAnnotationFeedback(rating?: string, limit = 100, offset = 0): AnnotationFeedback[] {
  const db = getDb();
  if (rating) {
    return db.prepare(
      'SELECT id, url, page_title, quote, explanation, ann_type, rating, created_at FROM annotation_feedback WHERE rating = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(rating, limit, offset) as AnnotationFeedback[];
  }
  return db.prepare(
    'SELECT id, url, page_title, quote, explanation, ann_type, rating, created_at FROM annotation_feedback ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as AnnotationFeedback[];
}

export function updateAnnotationFeedbackRating(feedbackId: number, rating: string): void {
  const db = getDb();
  db.prepare('UPDATE annotation_feedback SET rating = ? WHERE id = ?').run(rating, feedbackId);
}

export function deleteAnnotationFeedback(feedbackId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM annotation_feedback WHERE id = ?').run(feedbackId);
}

export function getAnnotationFeedbackStats(): { good: number; bad: number } {
  const db = getDb();
  const good = (db.prepare("SELECT COUNT(*) as count FROM annotation_feedback WHERE rating = 'good'").get() as { count: number }).count;
  const bad = (db.prepare("SELECT COUNT(*) as count FROM annotation_feedback WHERE rating = 'bad'").get() as { count: number }).count;
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
  const db = getDb();
  return db.prepare(
    'SELECT key, name, description, color, created_at FROM annotation_categories ORDER BY created_at'
  ).all() as AnnotationCategory[];
}

export function addAnnotationCategory(key: string, name: string, description: string, color: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO annotation_categories (key, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(key, name, description, color || '#888888', Date.now() / 1000);
}

export function deleteAnnotationCategory(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM annotation_categories WHERE key = ?').run(key);
}

