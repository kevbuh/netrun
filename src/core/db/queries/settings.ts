import { getDb } from '../connection.js';

export interface SettingRow {
  key: string;
  value: string;
  updated: number;
}

export function getSetting(key: string): SettingRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as SettingRow) ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated'
  ).run(key, value, Date.now() / 1000);
}

export function getAllSettings(): SettingRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM settings ORDER BY key').all() as SettingRow[];
}

export function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
