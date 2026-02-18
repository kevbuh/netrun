import { randomUUID } from 'crypto';
import { prepare } from '../connection.js';

export interface DirectMessage {
  id: string;
  from_google_id: string;
  to_google_id: string;
  content: string;
  timestamp: number;
  read: number;
}

export function getDirectMessages(googleId: string): DirectMessage[] {
  return prepare(
    'SELECT * FROM direct_messages WHERE to_google_id = ? ORDER BY timestamp DESC'
  ).all(googleId) as DirectMessage[];
}

export function sendDirectMessage(fromGoogleId: string, toGoogleId: string, content: string): DirectMessage {
  const id = randomUUID();
  const timestamp = Date.now() / 1000;
  prepare('INSERT INTO direct_messages (id, from_google_id, to_google_id, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(id, fromGoogleId, toGoogleId, content, timestamp);
  return { id, from_google_id: fromGoogleId, to_google_id: toGoogleId, content, timestamp, read: 0 };
}

export function toggleReaction(messageId: string, googleId: string, emoji: string): { added: boolean } {
  const existing = prepare(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND google_id = ? AND emoji = ?'
  ).get(messageId, googleId, emoji);
  if (existing) {
    prepare('DELETE FROM message_reactions WHERE message_id = ? AND google_id = ? AND emoji = ?').run(messageId, googleId, emoji);
    return { added: false };
  }
  prepare('INSERT INTO message_reactions (message_id, google_id, emoji, timestamp) VALUES (?, ?, ?, ?)').run(messageId, googleId, emoji, Date.now() / 1000);
  return { added: true };
}
