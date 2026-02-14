import { randomUUID } from 'crypto';
import { getDb } from '../connection.js';

export interface User {
  google_id: string;
  email: string;
  name: string;
  username?: string;
  picture?: string;
  profile_private?: number;
  last_seen?: number;
  status_emoji?: string;
  status_text?: string;
  profile_bg?: string;
  created: number;
}

export interface Session {
  token: string;
  google_id: string;
  expires: number;
}

const SESSION_TTL = 30 * 24 * 3600; // 30 days

export function getUser(googleId: string): User | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as User) ?? null;
}

export function getUserByUsername(username: string): User | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as User) ?? null;
}

export function upsertUser(data: { google_id: string; email: string; name: string; picture?: string }): User {
  const db = getDb();
  const existing = getUser(data.google_id);
  if (existing) {
    db.prepare('UPDATE users SET email = ?, name = ?, picture = ?, last_seen = ? WHERE google_id = ?')
      .run(data.email, data.name, data.picture ?? existing.picture, Date.now() / 1000, data.google_id);
  } else {
    db.prepare('INSERT INTO users (google_id, email, name, picture, created) VALUES (?, ?, ?, ?, ?)')
      .run(data.google_id, data.email, data.name, data.picture ?? '', Date.now() / 1000);
  }
  return getUser(data.google_id)!;
}

export function createSession(googleId: string): Session {
  const db = getDb();
  const token = randomUUID();
  const expires = Date.now() / 1000 + SESSION_TTL;
  db.prepare('INSERT INTO sessions (token, google_id, expires) VALUES (?, ?, ?)').run(token, googleId, expires);
  return { token, google_id: googleId, expires };
}

export function getSession(token: string): Session | null {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as Session | undefined;
  if (!session) return null;
  if (session.expires < Date.now() / 1000) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return session;
}

export function deleteSession(token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserData(googleId: string, key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_data WHERE google_id = ? AND key = ?').get(googleId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserData(googleId: string, key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES (?, ?, ?, ?)'
  ).run(googleId, key, value, Date.now() / 1000);
}

export function listUsers(limit = 50): User[] {
  const db = getDb();
  return db.prepare(
    'SELECT google_id, name, username, picture, status_emoji, status_text FROM users WHERE profile_private = 0 ORDER BY last_seen DESC LIMIT ?'
  ).all(limit) as User[];
}

export function searchUsers(query: string): User[] {
  const db = getDb();
  const pattern = `%${query}%`;
  return db.prepare(
    'SELECT google_id, name, username, picture, status_emoji, status_text FROM users WHERE profile_private = 0 AND (username LIKE ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE) LIMIT 20'
  ).all(pattern, pattern) as User[];
}

export function setUsername(googleId: string, username: string): boolean {
  const db = getDb();
  try {
    db.prepare('UPDATE users SET username = ? WHERE google_id = ?').run(username, googleId);
    return true;
  } catch {
    return false; // UNIQUE constraint violation
  }
}

export function deleteUser(googleId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Get owned teams
    const ownedTeams = db.prepare('SELECT id FROM teams WHERE owner_google_id = ?').all(googleId) as Array<{ id: number }>;
    // Delete per-user data
    db.prepare('DELETE FROM message_reactions WHERE google_id = ?').run(googleId);
    db.prepare('DELETE FROM calendar_events WHERE google_id = ?').run(googleId);
    db.prepare('DELETE FROM comments WHERE google_id = ?').run(googleId);
    db.prepare('DELETE FROM experiment_owners WHERE google_id = ?').run(googleId);
    // Delete owned teams and related data
    for (const t of ownedTeams) {
      db.prepare('DELETE FROM experiment_teams WHERE team_id = ?').run(t.id);
      db.prepare('DELETE FROM team_invites WHERE team_id = ?').run(t.id);
      db.prepare('DELETE FROM team_members WHERE team_id = ?').run(t.id);
      db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
    }
    db.prepare('DELETE FROM team_members WHERE google_id = ?').run(googleId);
    db.prepare('DELETE FROM team_invites WHERE from_google_id = ? OR to_google_id = ?').run(googleId, googleId);
    db.prepare('DELETE FROM user_data WHERE google_id = ?').run(googleId);
    db.prepare('DELETE FROM sessions WHERE google_id = ?').run(googleId);
    db.prepare('DELETE FROM users WHERE google_id = ?').run(googleId);
  });
  tx();
}

export function setUserStatus(googleId: string, emoji: string | null, text: string | null): void {
  const db = getDb();
  db.prepare('UPDATE users SET status_emoji = ?, status_text = ? WHERE google_id = ?').run(emoji || null, text || null, googleId);
}

export function setUserPrivacy(googleId: string, isPrivate: boolean): void {
  const db = getDb();
  db.prepare('UPDATE users SET profile_private = ? WHERE google_id = ?').run(isPrivate ? 1 : 0, googleId);
}

export function updateUserPicture(googleId: string, pictureUrl: string): void {
  const db = getDb();
  db.prepare('UPDATE users SET picture = ? WHERE google_id = ?').run(pictureUrl, googleId);
}

export function updateUserProfileBg(googleId: string, bgUrl: string): void {
  const db = getDb();
  db.prepare('UPDATE users SET profile_bg = ? WHERE google_id = ?').run(bgUrl, googleId);
}

export function getAllUserData(googleId: string): Record<string, { value: unknown; updated: number }> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, updated FROM user_data WHERE google_id = ?').all(googleId) as Array<{ key: string; value: string; updated: number }>;
  const result: Record<string, { value: unknown; updated: number }> = {};
  for (const row of rows) {
    try {
      result[row.key] = { value: JSON.parse(row.value), updated: row.updated };
    } catch {
      result[row.key] = { value: row.value, updated: row.updated };
    }
  }
  return result;
}

export function setUserDataBulk(googleId: string, data: Record<string, { value: unknown; updated?: number }>): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const [key, entry] of Object.entries(data)) {
      stmt.run(googleId, key, JSON.stringify(entry.value), entry.updated ?? Date.now() / 1000);
    }
  });
  tx();
}

export function syncUserData(
  googleId: string,
  clientData: Record<string, { value: unknown; updated?: number }>
): Record<string, { value: unknown; updated: number }> {
  const serverData = getAllUserData(googleId);
  const toSave: Record<string, { value: unknown; updated?: number }> = {};
  const merged: Record<string, { value: unknown; updated: number }> = {};

  const allKeys = new Set([...Object.keys(clientData), ...Object.keys(serverData)]);
  for (const key of allKeys) {
    const c = clientData[key];
    const s = serverData[key];
    if (c && s) {
      if ((c.updated ?? 0) >= s.updated) {
        toSave[key] = c;
        merged[key] = { value: c.value, updated: c.updated ?? Date.now() / 1000 };
      } else {
        merged[key] = s;
      }
    } else if (c) {
      toSave[key] = c;
      merged[key] = { value: c.value, updated: c.updated ?? Date.now() / 1000 };
    } else if (s) {
      merged[key] = s;
    }
  }
  if (Object.keys(toSave).length > 0) {
    setUserDataBulk(googleId, toSave);
  }
  return merged;
}
