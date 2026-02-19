import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const directMessages = new Map<string, any>();
const reactions = new Map<string, any>();

// No crypto mock needed — we don't control UUID values in these tests

const mockDb = {
  prepare: (sql: string) => ({
    get: (...args: any[]) => {
      if (sql.includes('FROM message_reactions')) {
        const key = `${args[0]}:${args[1]}:${args[2]}`;
        return reactions.get(key);
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM direct_messages')) {
        return Array.from(directMessages.values())
          .filter(m => m.to_google_id === args[0])
          .sort((a, b) => b.timestamp - a.timestamp);
      }
      return [];
    },
    run: (...args: any[]) => {
      if (sql.includes('INSERT INTO direct_messages')) {
        directMessages.set(args[0], {
          id: args[0], from_google_id: args[1], to_google_id: args[2],
          content: args[3], timestamp: args[4], read: 0,
        });
      } else if (sql.includes('DELETE FROM message_reactions')) {
        reactions.delete(`${args[0]}:${args[1]}:${args[2]}`);
      } else if (sql.includes('INSERT INTO message_reactions')) {
        reactions.set(`${args[0]}:${args[1]}:${args[2]}`, { message_id: args[0], google_id: args[1], emoji: args[2] });
      }
    },
  }),
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { getDirectMessages, sendDirectMessage, toggleReaction } from '../social';

beforeEach(() => {
  directMessages.clear();
  reactions.clear();
});

describe('direct messages', () => {
  it('getDirectMessages returns empty for new user', () => {
    expect(getDirectMessages('user1')).toEqual([]);
  });

  it('sendDirectMessage creates a message with UUID', () => {
    const msg = sendDirectMessage('from1', 'to1', 'Hello!');
    expect(msg.id).toBeTruthy();
    expect(msg.from_google_id).toBe('from1');
    expect(msg.to_google_id).toBe('to1');
    expect(msg.content).toBe('Hello!');
    expect(msg.read).toBe(0);
  });

  it('getDirectMessages returns messages for recipient', () => {
    sendDirectMessage('from1', 'to1', 'Message 1');
    sendDirectMessage('from2', 'to1', 'Message 2');
    sendDirectMessage('from1', 'to2', 'Other recipient');
    const msgs = getDirectMessages('to1');
    expect(msgs.length).toBe(2);
  });
});

describe('reactions', () => {
  it('toggleReaction adds a reaction', () => {
    const result = toggleReaction('msg1', 'user1', '👍');
    expect(result.added).toBe(true);
  });

  it('toggleReaction removes existing reaction', () => {
    toggleReaction('msg1', 'user1', '👍');
    const result = toggleReaction('msg1', 'user1', '👍');
    expect(result.added).toBe(false);
  });

  it('toggleReaction is idempotent — re-add after remove', () => {
    toggleReaction('msg1', 'user1', '👍');
    toggleReaction('msg1', 'user1', '👍');
    const result = toggleReaction('msg1', 'user1', '👍');
    expect(result.added).toBe(true);
  });
});
