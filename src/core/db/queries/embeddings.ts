import { createHash } from 'crypto';
import { getDb } from '../connection.js';

export interface EmbeddingRow {
  content_hash: string;
  content_type: string;
  title: string;
  link: string;
  source: string;
  embedding: Buffer;
  dim: number;
  created_at: number;
}

export interface ChatMemory {
  id: number;
  summary: string;
  topics: string;
  page_url: string;
  page_title: string;
  message_count: number;
  embedding: Buffer | null;
  dim: number;
  created_at: number;
}

/** SHA256 hash, first 20 chars */
export function embeddingHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 20);
}

/** Pack a float array into a binary buffer */
export function packEmbedding(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

/** Unpack a binary buffer into a float array */
export function unpackEmbedding(blob: Buffer, dim: number): number[] {
  const vec: number[] = [];
  for (let i = 0; i < dim; i++) {
    vec.push(blob.readFloatLE(i * 4));
  }
  return vec;
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export function storeEmbedding(
  text: string,
  title: string,
  link: string,
  source: string,
  contentType: string,
  vec: number[]
): boolean {
  const db = getDb();
  const hash = embeddingHash(text);
  const existing = db.prepare('SELECT 1 FROM embeddings WHERE content_hash = ?').get(hash);
  if (existing) return false;

  const blob = packEmbedding(vec);
  db.prepare(
    'INSERT INTO embeddings (content_hash, content_type, title, link, source, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(hash, contentType, title, link, source, blob, vec.length, Date.now() / 1000);
  return true;
}

export function searchEmbeddings(
  queryVec: number[],
  contentType?: string,
  limit = 5,
  excludeLink?: string
): Array<{ title: string; link: string; source: string; score: number }> {
  const db = getDb();
  let query = 'SELECT content_hash, content_type, title, link, source, embedding, dim FROM embeddings';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (contentType) {
    conditions.push('content_type = ?');
    params.push(contentType);
  }
  if (excludeLink) {
    conditions.push('link != ?');
    params.push(excludeLink);
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  const rows = db.prepare(query).all(...params) as EmbeddingRow[];
  const results = rows.map(row => {
    const vec = unpackEmbedding(row.embedding, row.dim);
    return {
      title: row.title,
      link: row.link,
      source: row.source,
      score: cosineSimilarity(queryVec, vec),
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function storeChatMemory(
  summary: string,
  topics: string,
  pageUrl: string,
  pageTitle: string,
  messageCount: number,
  vec?: number[]
): void {
  const db = getDb();
  const blob = vec ? packEmbedding(vec) : null;
  const dim = vec?.length ?? 0;
  db.prepare(
    'INSERT INTO chat_memories (summary, topics, page_url, page_title, message_count, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(summary, topics, pageUrl, pageTitle, messageCount, blob, dim, Date.now() / 1000);
}

export function searchChatMemories(
  queryVec: number[],
  limit = 3
): Array<{ id: number; summary: string; topics: string; page_title: string; score: number }> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, summary, topics, page_title, embedding, dim FROM chat_memories WHERE embedding IS NOT NULL'
  ).all() as ChatMemory[];

  const results = rows.map(row => {
    const vec = unpackEmbedding(row.embedding!, row.dim);
    return {
      id: row.id,
      summary: row.summary,
      topics: row.topics,
      page_title: row.page_title,
      score: cosineSimilarity(queryVec, vec),
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.filter(r => r.score > 0.5).slice(0, limit);
}

export function listChatMemories(limit = 20, offset = 0): { memories: ChatMemory[]; total: number } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM chat_memories').get() as { count: number }).count;
  const memories = db.prepare(
    'SELECT id, summary, topics, page_url, page_title, message_count, created_at FROM chat_memories ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as ChatMemory[];
  return { memories, total };
}

export function deleteChatMemory(memoryId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM chat_memories WHERE id = ?').run(memoryId);
}
