import { prepare } from '../connection.js';

export interface ChatThread {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  model: string;
  archived: number;
  metadata: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: number;
  metadata: string;
  parent_id: string | null;
}

export function createThread(id: string, title: string, model: string): ChatThread {
  const now = Date.now() / 1000;
  prepare(
    'INSERT INTO chat_threads (id, title, created_at, updated_at, model) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title || 'New Chat', now, now, model || '');
  return { id, title: title || 'New Chat', created_at: now, updated_at: now, model: model || '', archived: 0, metadata: '{}' };
}

export function getThread(id: string): ChatThread | undefined {
  return prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as ChatThread | undefined;
}

export function listThreads(limit = 50, archived = 0): ChatThread[] {
  return prepare(
    'SELECT * FROM chat_threads WHERE archived = ? ORDER BY updated_at DESC LIMIT ?'
  ).all(archived, limit) as ChatThread[];
}

export function updateThread(id: string, updates: { title?: string; model?: string; metadata?: string }): void {
  const now = Date.now() / 1000;
  if (updates.title !== undefined) {
    prepare('UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?').run(updates.title, now, id);
  }
  if (updates.model !== undefined) {
    prepare('UPDATE chat_threads SET model = ?, updated_at = ? WHERE id = ?').run(updates.model, now, id);
  }
  if (updates.metadata !== undefined) {
    prepare('UPDATE chat_threads SET metadata = ?, updated_at = ? WHERE id = ?').run(updates.metadata, now, id);
  }
}

export function archiveThread(id: string): void {
  prepare('UPDATE chat_threads SET archived = 1, updated_at = ? WHERE id = ?').run(Date.now() / 1000, id);
}

export function deleteThread(id: string): void {
  prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(id);
  prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
}

export function addMessage(id: string, threadId: string, role: string, content: string, metadata?: string, parentId?: string): ChatMessage {
  const now = Date.now() / 1000;
  prepare(
    'INSERT INTO chat_messages (id, thread_id, role, content, created_at, metadata, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, threadId, role, content, now, metadata || '{}', parentId || null);
  prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  return { id, thread_id: threadId, role, content, created_at: now, metadata: metadata || '{}', parent_id: parentId || null };
}

export function getMessages(threadId: string, limit = 200, offset = 0): ChatMessage[] {
  return prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(threadId, limit, offset) as ChatMessage[];
}

export function updateMessage(id: string, updates: { content?: string; metadata?: string }): void {
  if (updates.content !== undefined) {
    prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(updates.content, id);
  }
  if (updates.metadata !== undefined) {
    prepare('UPDATE chat_messages SET metadata = ? WHERE id = ?').run(updates.metadata, id);
  }
}

export function deleteMessage(id: string): void {
  prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
}

/** Get all messages for a thread (full tree, not just one path). */
export function getMessageTree(threadId: string): ChatMessage[] {
  return prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC'
  ).all(threadId) as ChatMessage[];
}

/** Walk parent_id chain from a leaf back to root, return path root→leaf order. */
export function getMessagePath(leafId: string): ChatMessage[] {
  const path: ChatMessage[] = [];
  let current = prepare('SELECT * FROM chat_messages WHERE id = ?').get(leafId) as ChatMessage | undefined;
  while (current) {
    path.unshift(current);
    if (!current.parent_id) break;
    current = prepare('SELECT * FROM chat_messages WHERE id = ?').get(current.parent_id) as ChatMessage | undefined;
  }
  return path;
}

/** Get direct children of a message (for finding branch points). */
export function getChildren(messageId: string): ChatMessage[] {
  return prepare(
    'SELECT * FROM chat_messages WHERE parent_id = ? ORDER BY created_at ASC'
  ).all(messageId) as ChatMessage[];
}

/** One-time migration: chain existing messages that have NULL parent_ids. */
export function migrateThreadParentIds(threadId: string): void {
  const msgs = prepare(
    'SELECT id, parent_id FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC'
  ).all(threadId) as { id: string; parent_id: string | null }[];

  // Only migrate if ALL messages have null parent_id (untouched thread)
  if (msgs.length < 2 || msgs.some(m => m.parent_id !== null)) return;

  const stmt = prepare('UPDATE chat_messages SET parent_id = ? WHERE id = ?');
  for (let i = 1; i < msgs.length; i++) {
    stmt.run(msgs[i - 1].id, msgs[i].id);
  }
}

export function searchThreads(query: string): ChatThread[] {
  return prepare(
    'SELECT * FROM chat_threads WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 50'
  ).all(`%${query}%`) as ChatThread[];
}
