import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { initSchema } from './schema.js';

let db: Database.Database | null = null;

/** Get or create the database connection */
export function getDb(): Database.Database {
  if (db) return db;

  // Use ARXIV_DATA_DIR if set (matches Flask), otherwise fall back to userData
  const dataDir = process.env.ARXIV_DATA_DIR
    ?? (app?.getPath('userData') ?? process.cwd());
  const dbPath = path.join(dataDir, 'netrun.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  initSchema(db);

  return db;
}

/** Close the database connection (call on app quit) */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
