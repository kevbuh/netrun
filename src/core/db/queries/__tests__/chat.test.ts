import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const threads = new Map<string, any>();
const messages = new Map<string, any>();

const mockDb = {
  prepare: (sql: string) => ({
    get: (...args: any[]) => {
      if (sql.includes('FROM chat_threads') && sql.includes('WHERE id')) {
        return threads.get(args[0]);
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM chat_threads') && sql.includes('LIKE')) {
        const q = args[0].replace(/%/g, '');
        return Array.from(threads.values()).filter(t => t.title.toLowerCase().includes(q.toLowerCase()));
      }
      if (sql.includes('FROM chat_threads')) {
        const archived = args[0] ?? 0;
        return Array.from(threads.values())
          .filter(t => t.archived === archived)
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, args[1] ?? 50);
      }
      if (sql.includes('FROM chat_messages')) {
        const threadId = args[0];
        return Array.from(messages.values())
          .filter(m => m.thread_id === threadId)
          .sort((a, b) => a.created_at - b.created_at)
          .slice(args[2] ?? 0, (args[2] ?? 0) + (args[1] ?? 200));
      }
      return [];
    },
    run: (...args: any[]) => {
      if (sql.includes('INSERT INTO chat_threads')) {
        threads.set(args[0], {
          id: args[0], title: args[1], created_at: args[2], updated_at: args[3],
          model: args[4], archived: 0, metadata: '{}',
        });
      } else if (sql.includes('INSERT INTO chat_messages')) {
        messages.set(args[0], {
          id: args[0], thread_id: args[1], role: args[2], content: args[3],
          created_at: args[4], metadata: args[5],
        });
      } else if (sql.includes('UPDATE chat_threads SET title')) {
        const t = threads.get(args[2]);
        if (t) { t.title = args[0]; t.updated_at = args[1]; }
      } else if (sql.includes('UPDATE chat_threads SET model')) {
        const t = threads.get(args[2]);
        if (t) { t.model = args[0]; t.updated_at = args[1]; }
      } else if (sql.includes('UPDATE chat_threads SET metadata')) {
        const t = threads.get(args[2]);
        if (t) { t.metadata = args[0]; t.updated_at = args[1]; }
      } else if (sql.includes('UPDATE chat_threads SET archived')) {
        const t = threads.get(args[1]);
        if (t) { t.archived = 1; t.updated_at = args[0]; }
      } else if (sql.includes('UPDATE chat_threads SET updated_at')) {
        const t = threads.get(args[1]);
        if (t) { t.updated_at = args[0]; }
      } else if (sql.includes('UPDATE chat_messages SET content')) {
        const m = messages.get(args[1]);
        if (m) m.content = args[0];
      } else if (sql.includes('UPDATE chat_messages SET metadata')) {
        const m = messages.get(args[1]);
        if (m) m.metadata = args[0];
      } else if (sql.includes('DELETE FROM chat_messages WHERE thread_id')) {
        for (const [k, m] of messages) { if (m.thread_id === args[0]) messages.delete(k); }
      } else if (sql.includes('DELETE FROM chat_threads')) {
        threads.delete(args[0]);
      } else if (sql.includes('DELETE FROM chat_messages WHERE id')) {
        messages.delete(args[0]);
      }
    },
  }),
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { createThread, getThread, listThreads, updateThread, archiveThread, deleteThread, addMessage, getMessages, deleteMessage, searchThreads } from '../chat';

beforeEach(() => { threads.clear(); messages.clear(); });

describe('chat thread queries', () => {
  it('createThread returns thread with defaults', () => {
    const t = createThread('t1', '', '');
    expect(t.id).toBe('t1');
    expect(t.title).toBe('New Chat');
    expect(t.archived).toBe(0);
  });

  it('getThread returns undefined for missing id', () => {
    expect(getThread('nonexistent')).toBeUndefined();
  });

  it('getThread retrieves created thread', () => {
    createThread('t1', 'My Chat', 'qwen');
    const t = getThread('t1');
    expect(t).toBeDefined();
    expect(t!.title).toBe('My Chat');
    expect(t!.model).toBe('qwen');
  });

  it('listThreads returns non-archived sorted by updated_at', () => {
    createThread('t1', 'Old', '');
    createThread('t2', 'New', '');
    const list = listThreads();
    expect(list.length).toBe(2);
  });

  it('updateThread changes title', () => {
    createThread('t1', 'Old', '');
    updateThread('t1', { title: 'New Title' });
    expect(getThread('t1')!.title).toBe('New Title');
  });

  it('archiveThread sets archived flag', () => {
    createThread('t1', 'Test', '');
    archiveThread('t1');
    expect(getThread('t1')!.archived).toBe(1);
  });

  it('deleteThread removes thread and messages', () => {
    createThread('t1', 'Test', '');
    addMessage('m1', 't1', 'user', 'hello');
    deleteThread('t1');
    expect(getThread('t1')).toBeUndefined();
    expect(getMessages('t1')).toEqual([]);
  });

  it('searchThreads matches by title', () => {
    createThread('t1', 'AI Research', '');
    createThread('t2', 'Cooking Tips', '');
    const results = searchThreads('research');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('AI Research');
  });
});

describe('chat message queries', () => {
  it('addMessage creates message and updates thread', () => {
    createThread('t1', 'Test', '');
    const msg = addMessage('m1', 't1', 'user', 'hello');
    expect(msg.id).toBe('m1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('getMessages returns messages in order', () => {
    createThread('t1', 'Test', '');
    addMessage('m1', 't1', 'user', 'hello');
    addMessage('m2', 't1', 'assistant', 'hi there');
    const msgs = getMessages('t1');
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
  });

  it('deleteMessage removes single message', () => {
    createThread('t1', 'Test', '');
    addMessage('m1', 't1', 'user', 'hello');
    addMessage('m2', 't1', 'assistant', 'hi');
    deleteMessage('m1');
    const msgs = getMessages('t1');
    expect(msgs.length).toBe(1);
    expect(msgs[0].id).toBe('m2');
  });
});
