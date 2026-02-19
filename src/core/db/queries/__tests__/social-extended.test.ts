import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const dms = new Map<string, any>();
const comments = new Map<string, any>();
const reposts = new Map<string, any>();
const achievements = new Map<string, any>();
const userData = new Map<string, any>();

// No crypto mock needed — we don't control UUID values in these tests

const mockDb = {
  prepare: (sql: string) => ({
    get: (...args: any[]) => {
      if (sql.includes('FROM direct_messages') && sql.includes('COUNT')) {
        let count = 0;
        for (const m of dms.values()) { if (m.to_google_id === args[0] && !m.read) count++; }
        return { count };
      }
      if (sql.includes('FROM comments WHERE id') && sql.includes('google_id')) {
        for (const c of comments.values()) { if (c.id === args[0] && c.google_id === args[1]) return c; }
        return undefined;
      }
      if (sql.includes('FROM achievements WHERE google_id') && sql.includes('achievement_id')) {
        return achievements.get(`${args[0]}:${args[1]}`);
      }
      if (sql.includes('FROM users WHERE lower(username)')) {
        return undefined; // stub
      }
      if (sql.includes("FROM user_data WHERE google_id = ? AND key = 'accentColor'")) {
        return userData.get(`${args[0]}:accentColor`);
      }
      if (sql.includes('COUNT(*) as c FROM comments')) {
        let c = 0;
        for (const cm of comments.values()) { if (cm.google_id === args[0]) c++; }
        return { c };
      }
      if (sql.includes('COUNT(*) as c FROM reposts')) {
        let c = 0;
        for (const r of reposts.values()) { if (r.google_id === args[0]) c++; }
        return { c };
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM comments') && sql.includes('paper_link = ?')) {
        return Array.from(comments.values()).filter(c => c.paper_link === args[0]);
      }
      if (sql.includes('FROM comments') && sql.includes('ORDER BY timestamp')) {
        return Array.from(comments.values());
      }
      if (sql.includes('SELECT id, parent_id FROM comments')) {
        return Array.from(comments.values()).map(c => ({ id: c.id, parent_id: c.parent_id }));
      }
      if (sql.includes('FROM achievements WHERE google_id')) {
        return Array.from(achievements.entries())
          .filter(([k]) => k.startsWith(args[0] + ':'))
          .map(([, v]) => v);
      }
      if (sql.includes('FROM reposts WHERE google_id')) {
        return Array.from(reposts.values()).filter(r => r.google_id === args[0]);
      }
      if (sql.includes('FROM comments WHERE google_id')) {
        return Array.from(comments.values()).filter(c => c.google_id === args[0]);
      }
      return [];
    },
    run: (...args: any[]) => {
      if (sql.includes('UPDATE direct_messages SET read')) {
        const m = dms.get(args[0]);
        if (m && m.to_google_id === args[1]) m.read = 1;
        return { changes: m ? 1 : 0 };
      }
      if (sql.includes('DELETE FROM direct_messages')) {
        const m = dms.get(args[0]);
        if (m && m.to_google_id === args[1]) { dms.delete(args[0]); return { changes: 1 }; }
        return { changes: 0 };
      }
      if (sql.includes('INSERT INTO comments')) {
        comments.set(args[0], {
          id: args[0], paper_link: args[1], google_id: args[2], author: args[3],
          content: args[4], timestamp: args[5], parent_id: args[6],
        });
      }
      if (sql.includes('DELETE FROM comments WHERE id IN')) {
        for (const id of args) comments.delete(id);
      }
      if (sql.includes('INSERT INTO reposts')) {
        reposts.set(args[0], {
          id: args[0], google_id: args[1], username: args[2],
          paper_link: args[3], paper_title: args[4], timestamp: args[5],
        });
      }
      if (sql.includes('DELETE FROM reposts')) {
        for (const [k, r] of reposts) {
          if (r.google_id === args[0] && r.paper_link === args[1]) reposts.delete(k);
        }
      }
      if (sql.includes('INSERT INTO achievements')) {
        achievements.set(`${args[0]}:${args[1]}`, {
          achievement_id: args[1], unlocked_at: args[2],
        });
      }
    },
  }),
  transaction: (fn: () => void) => fn,
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { markMessageRead, deleteDirectMessage, getUnreadMessageCount, getComments, createComment, deleteComment, createRepost, deleteRepost, getUserReposts, grantAchievement, getUserAchievements, getUserPublicStats } from '../social-extended';

beforeEach(() => {
  dms.clear();
  comments.clear();
  reposts.clear();
  achievements.clear();
  userData.clear();
});

describe('DM operations', () => {
  it('markMessageRead sets read flag', () => {
    dms.set('dm1', { id: 'dm1', to_google_id: 'user1', read: 0 });
    markMessageRead('user1', 'dm1');
    expect(dms.get('dm1').read).toBe(1);
  });

  it('deleteDirectMessage removes message owned by recipient', () => {
    dms.set('dm1', { id: 'dm1', to_google_id: 'user1', read: 0 });
    expect(deleteDirectMessage('user1', 'dm1')).toBe(true);
    expect(dms.has('dm1')).toBe(false);
  });

  it('deleteDirectMessage returns false for wrong recipient', () => {
    dms.set('dm1', { id: 'dm1', to_google_id: 'user1', read: 0 });
    expect(deleteDirectMessage('user2', 'dm1')).toBe(false);
  });

  it('getUnreadMessageCount counts unread messages', () => {
    dms.set('dm1', { id: 'dm1', to_google_id: 'user1', read: 0 });
    dms.set('dm2', { id: 'dm2', to_google_id: 'user1', read: 1 });
    dms.set('dm3', { id: 'dm3', to_google_id: 'user1', read: 0 });
    expect(getUnreadMessageCount('user1')).toBe(2);
  });
});

describe('comments', () => {
  it('createComment returns comment with generated id', () => {
    const c = createComment('g1', { paperLink: 'http://paper', content: 'Great paper!' }) as any;
    expect(c.id).toBeTruthy();
    expect(c.content).toBe('Great paper!');
    expect(c.author).toBe('Anonymous');
  });

  it('getComments filters by paperLink', () => {
    createComment('g1', { paperLink: 'link1', content: 'A' });
    createComment('g1', { paperLink: 'link2', content: 'B' });
    const results = getComments('link1');
    expect(results.length).toBe(1);
  });

  it('getComments returns all when no filter', () => {
    createComment('g1', { paperLink: 'link1', content: 'A' });
    createComment('g1', { paperLink: 'link2', content: 'B' });
    expect(getComments().length).toBe(2);
  });
});

describe('reposts', () => {
  it('createRepost stores repost', () => {
    const r = createRepost('g1', 'alice', 'http://paper', 'Paper Title') as any;
    expect(r.id).toBeTruthy();
    expect(r.paperTitle).toBe('Paper Title');
  });

  it('getUserReposts returns user reposts', () => {
    createRepost('g1', 'alice', 'http://paper1', 'P1');
    createRepost('g2', 'bob', 'http://paper2', 'P2');
    const reposts = getUserReposts('g1');
    expect(reposts.length).toBe(1);
  });

  it('deleteRepost removes repost', () => {
    createRepost('g1', 'alice', 'http://paper1', 'P1');
    deleteRepost('g1', 'http://paper1');
    expect(getUserReposts('g1').length).toBe(0);
  });
});

describe('achievements', () => {
  it('grantAchievement returns null for unknown achievement', () => {
    expect(grantAchievement('g1', 'nonexistent')).toBeNull();
  });

  it('grantAchievement grants valid achievement', () => {
    const ach = grantAchievement('g1', 'first_status');
    expect(ach).not.toBeNull();
    expect((ach as any).name).toBe('Statusphere');
  });

  it('grantAchievement returns null on duplicate', () => {
    grantAchievement('g1', 'first_status');
    expect(grantAchievement('g1', 'first_status')).toBeNull();
  });
});

describe('public stats', () => {
  it('getUserPublicStats counts comments and reposts', () => {
    createComment('g1', { paperLink: 'link1', content: 'A' });
    createComment('g1', { paperLink: 'link2', content: 'B' });
    createRepost('g1', 'alice', 'http://paper', 'P');
    const stats = getUserPublicStats('g1');
    expect(stats.comment_count).toBe(2);
    expect(stats.repost_count).toBe(1);
  });
});
