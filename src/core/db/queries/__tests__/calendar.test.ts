import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const mockRows = new Map<string, any>();
// No crypto mock needed — we don't control UUID values in these tests
const mockDb = {
  prepare: (sql: string) => ({
    get: (...args: any[]) => {
      if (sql.includes('WHERE id = ? AND google_id = ?')) {
        for (const row of mockRows.values()) {
          if (row.id === args[0] && row.google_id === args[1]) return row;
        }
        return undefined;
      }
      if (sql.includes('WHERE id = ?')) {
        return mockRows.get(args[0]);
      }
      return undefined;
    },
    all: (googleId: string) => {
      return Array.from(mockRows.values())
        .filter(r => r.google_id === googleId)
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    run: (...args: any[]) => {
      if (sql.includes('INSERT')) {
        mockRows.set(args[0], {
          id: args[0], google_id: args[1], title: args[2],
          date: args[3], description: args[4], color: args[5],
        });
      } else if (sql.includes('UPDATE')) {
        // Dynamic update — parse SET clause
        const setMatch = sql.match(/SET (.+?) WHERE/);
        if (setMatch) {
          const fields = setMatch[1].split(',').map(f => f.trim().split(' = ')[0]);
          // Last two args are id and google_id
          const id = args[args.length - 2];
          const gid = args[args.length - 1];
          const row = mockRows.get(id);
          if (row && row.google_id === gid) {
            fields.forEach((f, i) => { row[f] = args[i]; });
          }
        }
      } else if (sql.includes('DELETE')) {
        const id = args[0];
        const gid = args[1];
        for (const [k, row] of mockRows) {
          if (row.id === id && row.google_id === gid) {
            mockRows.delete(k);
            return { changes: 1 };
          }
        }
        return { changes: 0 };
      }
      return { changes: 0 };
    },
  }),
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../calendar';

beforeEach(() => { mockRows.clear(); });

describe('calendar queries', () => {
  it('getCalendarEvents returns empty for unknown user', () => {
    expect(getCalendarEvents('unknown')).toEqual([]);
  });

  it('createCalendarEvent returns event with generated id', () => {
    const event = createCalendarEvent('user1', { title: 'Meeting', date: '2024-01-15' });
    expect(event.id).toBeTruthy();
    expect(event.title).toBe('Meeting');
    expect(event.date).toBe('2024-01-15');
    expect(event.color).toBe('#b4451a'); // default
  });

  it('createCalendarEvent uses provided color', () => {
    const event = createCalendarEvent('user1', { title: 'Test', date: '2024-01-15', color: '#ff0000' });
    expect(event.color).toBe('#ff0000');
  });

  it('getCalendarEvents returns user events sorted by date', () => {
    createCalendarEvent('user1', { title: 'B', date: '2024-02-01' });
    createCalendarEvent('user1', { title: 'A', date: '2024-01-01' });
    createCalendarEvent('user2', { title: 'Other', date: '2024-01-15' });
    const events = getCalendarEvents('user1');
    expect(events.length).toBe(2);
    expect(events[0].title).toBe('A');
    expect(events[1].title).toBe('B');
  });

  it('deleteCalendarEvent returns false for non-existent event', () => {
    expect(deleteCalendarEvent('user1', 'fake-id')).toBe(false);
  });
});
