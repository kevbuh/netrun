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
