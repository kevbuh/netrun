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

export function addMessage(id: string, threadId: string, role: string, content: string, metadata?: string): ChatMessage {
  const now = Date.now() / 1000;
  prepare(
    'INSERT INTO chat_messages (id, thread_id, role, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, threadId, role, content, now, metadata || '{}');
  prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  return { id, thread_id: threadId, role, content, created_at: now, metadata: metadata || '{}' };
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

export function searchThreads(query: string): ChatThread[] {
  return prepare(
    'SELECT * FROM chat_threads WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 50'
  ).all(`%${query}%`) as ChatThread[];
}
