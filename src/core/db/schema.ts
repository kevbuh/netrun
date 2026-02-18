import type Database from 'better-sqlite3';

/**
 * Initialize all database tables. Ported from Python db.py:init_db().
 * Uses CREATE TABLE IF NOT EXISTS for idempotency.
 */
export function initSchema(db: Database.Database): void {
  // ── User management ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      google_id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      username TEXT UNIQUE,
      picture TEXT,
      profile_private INTEGER DEFAULT 0,
      last_seen REAL,
      status_emoji TEXT,
      status_text TEXT,
      profile_bg TEXT,
      created REAL NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
      ON users(username COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      google_id TEXT NOT NULL,
      expires REAL NOT NULL,
      FOREIGN KEY (google_id) REFERENCES users(google_id)
    );

    CREATE TABLE IF NOT EXISTS user_data (
      google_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated REAL NOT NULL,
      PRIMARY KEY (google_id, key),
      FOREIGN KEY (google_id) REFERENCES users(google_id)
    );
  `);

  // ── Per-user data ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      google_id TEXT NOT NULL REFERENCES users(google_id),
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      paper_link TEXT NOT NULL,
      google_id TEXT NOT NULL REFERENCES users(google_id),
      author TEXT,
      content TEXT NOT NULL,
      timestamp REAL NOT NULL,
      parent_id TEXT
    );
  `);

  // ── Messaging ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      from_google_id TEXT NOT NULL REFERENCES users(google_id),
      to_google_id TEXT NOT NULL REFERENCES users(google_id),
      content TEXT NOT NULL,
      timestamp REAL NOT NULL,
      read INTEGER DEFAULT 0
    );

  `);

  // ── Social ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS reposts (
      id TEXT PRIMARY KEY,
      google_id TEXT NOT NULL REFERENCES users(google_id),
      username TEXT,
      paper_link TEXT NOT NULL,
      paper_title TEXT,
      timestamp REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievements (
      google_id TEXT NOT NULL REFERENCES users(google_id),
      achievement_id TEXT NOT NULL,
      unlocked_at REAL NOT NULL,
      PRIMARY KEY (google_id, achievement_id)
    );
  `);

  // ── Content caches ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS reference_cache (
      arxiv_id TEXT PRIMARY KEY,
      references_json TEXT NOT NULL,
      cached_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS author_cache (
      query TEXT PRIMARY KEY,
      author_json TEXT NOT NULL,
      cached_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quality_cache (
      title_hash TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      verdict TEXT,
      score INTEGER,
      cached_at REAL NOT NULL,
      PRIMARY KEY (title_hash, prompt_hash)
    );

    CREATE TABLE IF NOT EXISTS smart_highlights_cache (
      url_hash TEXT PRIMARY KEY,
      highlights_json TEXT NOT NULL,
      cached_at REAL NOT NULL
    );
  `);

  // ── Feed ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      authors TEXT DEFAULT '',
      categories TEXT DEFAULT '[]',
      description TEXT DEFAULT '',
      pub_date TEXT,
      display_date TEXT DEFAULT '',
      arxiv_id TEXT,
      extra TEXT DEFAULT '{}',
      fetched_at REAL NOT NULL,
      UNIQUE(source, link)
    );
    CREATE INDEX IF NOT EXISTS idx_fi_source ON feed_items(source);
    CREATE INDEX IF NOT EXISTS idx_fi_pubdate ON feed_items(pub_date DESC);
  `);

  // ── Context meta (living context file tracking) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_meta (
      file_id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      compacted_at REAL,
      char_count INTEGER DEFAULT 0,
      file_type TEXT DEFAULT 'topic',
      description TEXT DEFAULT ''
    );
  `);

  // Migration: add file_type and description columns for existing DBs
  try {
    db.exec(`ALTER TABLE context_meta ADD COLUMN file_type TEXT DEFAULT 'topic'`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE context_meta ADD COLUMN description TEXT DEFAULT ''`);
  } catch { /* column already exists */ }

  // Seed main.md as identity type
  try {
    db.exec(`UPDATE context_meta SET file_type = 'identity' WHERE file_id = 'main.md'`);
  } catch { /* ignore */ }

  // ── Annotations ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotation_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT DEFAULT '',
      page_title TEXT DEFAULT '',
      quote TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      ann_type TEXT DEFAULT '',
      rating TEXT NOT NULL,
      created_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotation_categories (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888888',
      created_at REAL NOT NULL
    );
  `);

  // ── Usage log ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      ts REAL NOT NULL
    );
  `);

  // ── Settings (unified key-value store for app preferences) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated REAL NOT NULL
    );
  `);
}
