import { randomUUID } from 'crypto';
import { getDb, prepare } from '../connection.js';

export interface CalendarEvent {
  id: string;
  google_id: string;
  title: string;
  date: string;
  description?: string;
  color?: string;
}

export function getCalendarEvents(googleId: string): CalendarEvent[] {
  return prepare(
    'SELECT id, title, date, description, color FROM calendar_events WHERE google_id = ? ORDER BY date'
  ).all(googleId) as CalendarEvent[];
}

export function createCalendarEvent(
  googleId: string,
  data: { title: string; date: string; description?: string; color?: string }
): CalendarEvent {
  const id = randomUUID();
  const color = data.color ?? '#b4451a';
  prepare(
    'INSERT INTO calendar_events (id, google_id, title, date, description, color) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, googleId, data.title, data.date, data.description ?? '', color);
  return { id, google_id: googleId, title: data.title, date: data.date, description: data.description, color };
}

export function updateCalendarEvent(
  googleId: string,
  eventId: string,
  updates: Partial<Pick<CalendarEvent, 'title' | 'date' | 'description' | 'color'>>
): CalendarEvent | null {
  const existing = prepare(
    'SELECT id, title, date, description, color FROM calendar_events WHERE id = ? AND google_id = ?'
  ).get(eventId, googleId) as CalendarEvent | undefined;
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (['title', 'date', 'description', 'color'].includes(key) && val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length > 0) {
    values.push(eventId, googleId);
    // Dynamic SQL — can't cache
    getDb().prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ? AND google_id = ?`).run(...values);
  }
  return prepare(
    'SELECT id, title, date, description, color FROM calendar_events WHERE id = ?'
  ).get(eventId) as CalendarEvent;
}

export function deleteCalendarEvent(googleId: string, eventId: string): boolean {
  const result = prepare(
    'DELETE FROM calendar_events WHERE id = ? AND google_id = ?'
  ).run(eventId, googleId);
  return result.changes > 0;
}
