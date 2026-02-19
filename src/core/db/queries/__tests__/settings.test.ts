import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ──
const mockStore = new Map<string, { key: string; value: string; updated: number }>();
const mockDb = {
  prepare: (sql: string) => ({
    get: (key: string) => mockStore.get(key) ?? undefined,
    all: () => Array.from(mockStore.values()).sort((a, b) => a.key.localeCompare(b.key)),
    run: (...args: any[]) => {
      if (sql.includes('INSERT') || sql.includes('UPSERT') || sql.includes('ON CONFLICT')) {
        mockStore.set(args[0], { key: args[0], value: args[1], updated: args[2] });
      } else if (sql.includes('DELETE')) {
        mockStore.delete(args[0]);
      }
    },
  }),
};
vi.mock('../../connection', () => ({
  prepare: (sql: string) => mockDb.prepare(sql),
  getDb: () => mockDb,
}));

import { getSetting, setSetting, getAllSettings, deleteSetting } from '../settings';

beforeEach(() => { mockStore.clear(); });

describe('settings queries', () => {
  it('getSetting returns null for missing key', () => {
    expect(getSetting('nonexistent')).toBeNull();
  });

  it('setSetting stores and getSetting retrieves', () => {
    setSetting('theme', 'dark');
    const row = getSetting('theme');
    expect(row).not.toBeNull();
    expect(row!.key).toBe('theme');
    expect(row!.value).toBe('dark');
    expect(row!.updated).toBeGreaterThan(0);
  });

  it('setSetting overwrites existing value', () => {
    setSetting('theme', 'dark');
    setSetting('theme', 'light');
    expect(getSetting('theme')!.value).toBe('light');
  });

  it('getAllSettings returns all rows sorted by key', () => {
    setSetting('b', '2');
    setSetting('a', '1');
    const all = getAllSettings();
    expect(all.length).toBe(2);
    expect(all[0].key).toBe('a');
    expect(all[1].key).toBe('b');
  });

  it('deleteSetting removes the key', () => {
    setSetting('toDelete', 'val');
    expect(getSetting('toDelete')).not.toBeNull();
    deleteSetting('toDelete');
    expect(getSetting('toDelete')).toBeNull();
  });

  it('getAllSettings returns empty array when no settings', () => {
    expect(getAllSettings()).toEqual([]);
  });
});
