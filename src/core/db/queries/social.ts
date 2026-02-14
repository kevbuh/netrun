import { randomUUID } from 'crypto';
import { getDb } from '../connection.js';

export interface Team {
  id: number;
  name: string;
  owner_google_id: string;
  private: number;
  parent_id: number | null;
  created: string;
}

export interface TeamMessage {
  id: string;
  team_id: number;
  google_id: string;
  content: string;
  timestamp: number;
  edited: number;
}

export interface DirectMessage {
  id: string;
  from_google_id: string;
  to_google_id: string;
  content: string;
  timestamp: number;
  read: number;
}

export interface TeamTodo {
  id: string;
  team_id: number;
  google_id: string;
  title: string;
  done: number;
  priority: string;
  assigned_to: string | null;
  description: string | null;
  timestamp: number;
}

export function getUserTeams(googleId: string): Team[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.* FROM teams t
    JOIN team_members tm ON t.id = tm.team_id
    WHERE tm.google_id = ?
    ORDER BY t.name
  `).all(googleId) as Team[];
}

export function getTeam(teamId: number): Team | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Team) ?? null;
}

export function createTeam(name: string, ownerGoogleId: string, options?: { private?: boolean; parentId?: number }): number {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO teams (name, owner_google_id, private, parent_id) VALUES (?, ?, ?, ?)'
  ).run(name, ownerGoogleId, options?.private ? 1 : 0, options?.parentId ?? null);
  const teamId = result.lastInsertRowid as number;
  db.prepare('INSERT INTO team_members (team_id, google_id, role) VALUES (?, ?, ?)').run(teamId, ownerGoogleId, 'owner');
  return teamId;
}

export function deleteTeam(teamId: number, ownerGoogleId: string): boolean {
  const db = getDb();
  const team = getTeam(teamId);
  if (!team || team.owner_google_id !== ownerGoogleId) return false;
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  return true;
}

export function getTeamMembers(teamId: number): Array<{ google_id: string; role: string; joined: string }> {
  const db = getDb();
  return db.prepare('SELECT google_id, role, joined FROM team_members WHERE team_id = ?').all(teamId) as any[];
}

export function isTeamMember(teamId: number, googleId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?').get(teamId, googleId);
  return !!row;
}

export function getTeamMessages(teamId: number, limit = 100): TeamMessage[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM team_messages WHERE team_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(teamId, limit) as TeamMessage[];
}

export function sendTeamMessage(teamId: number, googleId: string, content: string): TeamMessage {
  const db = getDb();
  const id = randomUUID();
  const timestamp = Date.now() / 1000;
  db.prepare('INSERT INTO team_messages (id, team_id, google_id, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(id, teamId, googleId, content, timestamp);
  return { id, team_id: teamId, google_id: googleId, content, timestamp, edited: 0 };
}

export function deleteTeamMessage(messageId: string, googleId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM team_messages WHERE id = ? AND google_id = ?').run(messageId, googleId);
  return result.changes > 0;
}

export function getDirectMessages(googleId: string): DirectMessage[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM direct_messages WHERE to_google_id = ? ORDER BY timestamp DESC'
  ).all(googleId) as DirectMessage[];
}

export function sendDirectMessage(fromGoogleId: string, toGoogleId: string, content: string): DirectMessage {
  const db = getDb();
  const id = randomUUID();
  const timestamp = Date.now() / 1000;
  db.prepare('INSERT INTO direct_messages (id, from_google_id, to_google_id, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(id, fromGoogleId, toGoogleId, content, timestamp);
  return { id, from_google_id: fromGoogleId, to_google_id: toGoogleId, content, timestamp, read: 0 };
}

export function getTeamTodos(teamId: number): TeamTodo[] {
  const db = getDb();
  return db.prepare('SELECT * FROM team_todos WHERE team_id = ? ORDER BY timestamp DESC').all(teamId) as TeamTodo[];
}

export function createTeamTodo(teamId: number, googleId: string, data: { title: string; priority?: string; assigned_to?: string; description?: string }): TeamTodo {
  const db = getDb();
  const id = randomUUID();
  const timestamp = Date.now() / 1000;
  db.prepare(
    'INSERT INTO team_todos (id, team_id, google_id, title, priority, assigned_to, description, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, teamId, googleId, data.title, data.priority ?? 'medium', data.assigned_to ?? null, data.description ?? null, timestamp);
  return { id, team_id: teamId, google_id: googleId, title: data.title, done: 0, priority: data.priority ?? 'medium', assigned_to: data.assigned_to ?? null, description: data.description ?? null, timestamp };
}

export function toggleReaction(messageId: string, googleId: string, emoji: string): { added: boolean } {
  const db = getDb();
  const existing = db.prepare(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND google_id = ? AND emoji = ?'
  ).get(messageId, googleId, emoji);
  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND google_id = ? AND emoji = ?').run(messageId, googleId, emoji);
    return { added: false };
  }
  db.prepare('INSERT INTO message_reactions (message_id, google_id, emoji, timestamp) VALUES (?, ?, ?, ?)').run(messageId, googleId, emoji, Date.now() / 1000);
  return { added: true };
}
