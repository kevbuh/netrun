import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const users = new Map<string, any>();
const sessions = new Map<string, any>();
const userDataMap = new Map<string, any>();

// No crypto mock needed — we don't control UUID values in these tests

const mockDb = {
  prepare: (sql: string) => ({
    get: (...args: any[]) => {
      if (sql.includes('FROM users WHERE google_id')) return users.get(args[0]);
      if (sql.includes('FROM users WHERE username')) {
        for (const u of users.values()) { if (u.username?.toLowerCase() === args[0]?.toLowerCase()) return u; }
        return undefined;
      }
      if (sql.includes('FROM sessions WHERE token')) return sessions.get(args[0]);
      if (sql.includes('FROM user_data WHERE google_id = ? AND key = ?')) {
        return userDataMap.get(`${args[0]}:${args[1]}`);
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM user_data WHERE google_id = ?') && sql.includes('key IN')) {
        return Array.from(userDataMap.entries())
          .filter(([k]) => k.startsWith(args[0] + ':'))
          .map(([k, v]) => ({ key: k.split(':').slice(1).join(':'), value: v.value }));
      }
      if (sql.includes('FROM user_data WHERE google_id = ?')) {
        return Array.from(userDataMap.entries())
          .filter(([k]) => k.startsWith(args[0] + ':'))
          .map(([k, v]) => ({ key: k.split(':').slice(1).join(':'), value: v.value, updated: v.updated }));
      }
      if (sql.includes('FROM users WHERE profile_private = 0') && sql.includes('LIKE')) {
        return [];
      }
      if (sql.includes('FROM users WHERE profile_private = 0')) {
        return Array.from(users.values()).filter(u => !u.profile_private).slice(0, args[0] ?? 50);
      }
      return [];
    },
    run: (...args: any[]) => {
      if (sql.includes('INSERT INTO users')) {
        users.set(args[0], { google_id: args[0], email: args[1], name: args[2], picture: args[3], created: args[4], profile_private: 0 });
      } else if (sql.includes('UPDATE users SET email')) {
        const u = users.get(args[4]);
        if (u) { u.email = args[0]; u.name = args[1]; u.picture = args[2]; u.last_seen = args[3]; }
      } else if (sql.includes('UPDATE users SET username')) {
        const u = users.get(args[1]);
        if (u) u.username = args[0];
      } else if (sql.includes('UPDATE users SET status_emoji')) {
        const u = users.get(args[2]);
        if (u) { u.status_emoji = args[0]; u.status_text = args[1]; }
      } else if (sql.includes('UPDATE users SET profile_private')) {
        const u = users.get(args[1]);
        if (u) u.profile_private = args[0];
      } else if (sql.includes('UPDATE users SET picture = ?')) {
        const u = users.get(args[1]);
        if (u) u.picture = args[0];
      } else if (sql.includes('INSERT INTO sessions')) {
        sessions.set(args[0], { token: args[0], google_id: args[1], expires: args[2] });
      } else if (sql.includes('DELETE FROM sessions WHERE token')) {
        sessions.delete(args[0]);
      } else if (sql.includes('DELETE FROM sessions WHERE google_id')) {
        for (const [k, s] of sessions) { if (s.google_id === args[0]) sessions.delete(k); }
      } else if (sql.includes('DELETE FROM users WHERE google_id')) {
        users.delete(args[0]);
      } else if (sql.includes('INSERT OR REPLACE INTO user_data')) {
        userDataMap.set(`${args[0]}:${args[1]}`, { value: args[2], updated: args[3] });
      } else if (sql.includes('DELETE FROM user_data')) {
        for (const k of userDataMap.keys()) { if (k.startsWith(args[0] + ':')) userDataMap.delete(k); }
      } else if (sql.includes('DELETE FROM calendar_events') || sql.includes('DELETE FROM comments')) {
        // Cascade deletes — no-op in mock
      }
    },
  }),
  transaction: (fn: () => void) => fn,
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { getUser, upsertUser, createSession, getSession, deleteSession, getUserData, setUserData, setUsername, setUserStatus, setUserPrivacy, deleteUser, getAllUserData, syncUserData } from '../users';

beforeEach(() => {
  users.clear();
  sessions.clear();
  userDataMap.clear();
});

describe('user CRUD', () => {
  it('getUser returns null for unknown id', () => {
    expect(getUser('nonexistent')).toBeNull();
  });

  it('upsertUser creates new user', () => {
    const user = upsertUser({ google_id: 'g1', email: 'a@b.com', name: 'Alice' });
    expect(user.google_id).toBe('g1');
    expect(user.name).toBe('Alice');
  });

  it('upsertUser updates existing user', () => {
    upsertUser({ google_id: 'g1', email: 'a@b.com', name: 'Alice' });
    const updated = upsertUser({ google_id: 'g1', email: 'new@b.com', name: 'Alice B' });
    expect(updated.email).toBe('new@b.com');
    expect(updated.name).toBe('Alice B');
  });

  it('setUsername updates username', () => {
    upsertUser({ google_id: 'g1', email: 'a@b.com', name: 'Alice' });
    const ok = setUsername('g1', 'alice');
    expect(ok).toBe(true);
    expect(getUser('g1')!.username).toBe('alice');
  });

  it('setUserStatus sets emoji and text', () => {
    upsertUser({ google_id: 'g1', email: 'a@b.com', name: 'Alice' });
    setUserStatus('g1', '🎉', 'Celebrating');
    const u = getUser('g1')!;
    expect(u.status_emoji).toBe('🎉');
    expect(u.status_text).toBe('Celebrating');
  });

  it('setUserPrivacy toggles private flag', () => {
    upsertUser({ google_id: 'g1', email: 'a@b.com', name: 'Alice' });
    setUserPrivacy('g1', true);
    expect(getUser('g1')!.profile_private).toBe(1);
  });

  it('deleteUser removes user and related data', () => {
    upsertUser({ google_id: 'g1', email: 'a@b.com', name: 'Alice' });
    deleteUser('g1');
    expect(getUser('g1')).toBeNull();
  });
});

describe('session management', () => {
  it('createSession returns session with token', () => {
    const session = createSession('g1');
    expect(session.token).toBeTruthy();
    expect(session.google_id).toBe('g1');
    expect(session.expires).toBeGreaterThan(Date.now() / 1000);
  });

  it('getSession returns null for missing token', () => {
    expect(getSession('nonexistent')).toBeNull();
  });

  it('getSession retrieves valid session', () => {
    const s = createSession('g1');
    const got = getSession(s.token);
    expect(got).not.toBeNull();
    expect(got!.google_id).toBe('g1');
  });

  it('deleteSession removes session', () => {
    const s = createSession('g1');
    deleteSession(s.token);
    expect(getSession(s.token)).toBeNull();
  });
});

describe('user data', () => {
  it('getUserData returns null for missing key', () => {
    expect(getUserData('g1', 'theme')).toBeNull();
  });

  it('setUserData stores and getUserData retrieves', () => {
    setUserData('g1', 'theme', '"dark"');
    expect(getUserData('g1', 'theme')).toBe('"dark"');
  });

  it('getAllUserData returns all keys for user', () => {
    setUserData('g1', 'a', '"1"');
    setUserData('g1', 'b', '"2"');
    const all = getAllUserData('g1');
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['a'].value).toBe('1');
  });
});

describe('syncUserData', () => {
  it('saves client data when no server data exists', () => {
    const merged = syncUserData('g1', { theme: { value: 'dark', updated: 100 } });
    expect(merged['theme'].value).toBe('dark');
  });

  it('keeps newer server data when client is older', () => {
    setUserData('g1', 'theme', '"light"');
    // mock the updated timestamp to be 200
    userDataMap.set('g1:theme', { value: '"light"', updated: 200 });
    const merged = syncUserData('g1', { theme: { value: 'dark', updated: 100 } });
    expect(merged['theme'].value).toBe('light');
  });
});
