"""Database core - connection, initialization, and schema definitions."""

import os
import sqlite3
import time

# ── Constants and directories ──

DIR = os.environ.get('ARXIV_DATA_DIR', os.path.dirname(os.path.abspath(__file__)))
SAVED_CONTENT_DIR = os.path.join(DIR, 'saved_content')
os.makedirs(SAVED_CONTENT_DIR, exist_ok=True)

DB_PATH = os.path.join(DIR, 'netrun.db')
SESSION_TTL = 30 * 24 * 3600  # 30 days


# ── Core database functions ──

def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            google_id TEXT PRIMARY KEY,
            email TEXT,
            name TEXT,
            username TEXT UNIQUE,
            picture TEXT,
            created REAL NOT NULL
        );
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
    """)
    # Per-user data tables
    conn.executescript("""
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
    """)
    # Messaging tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS direct_messages (
            id TEXT PRIMARY KEY,
            from_google_id TEXT NOT NULL REFERENCES users(google_id),
            to_google_id TEXT NOT NULL REFERENCES users(google_id),
            content TEXT NOT NULL,
            timestamp REAL NOT NULL,
            read INTEGER DEFAULT 0
        );
    """)
    # Migration: add username column if missing
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if 'username' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN username TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)")
        conn.commit()
    else:
        # Migration: recreate username index with COLLATE NOCASE for case-insensitive uniqueness
        idx = conn.execute("PRAGMA index_info(idx_users_username)").fetchone()
        if idx:
            idx_sql = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_users_username'"
            ).fetchone()
            if idx_sql and 'NOCASE' not in (idx_sql[0] or ''):
                conn.execute("DROP INDEX idx_users_username")
                conn.execute("CREATE UNIQUE INDEX idx_users_username ON users(username COLLATE NOCASE)")
                conn.commit()
    if 'picture' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN picture TEXT")
        conn.commit()
    conn.executescript("""
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
    """)
    # Reference cache table (persistent — paper references don't change)
    conn.executescript("""
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
    """)
    # Migration: add profile_private column to users
    if 'profile_private' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN profile_private INTEGER DEFAULT 0")
        conn.commit()
    # Migration: add last_seen, status_emoji, status_text columns to users
    if 'last_seen' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN last_seen REAL")
        conn.commit()
    if 'status_emoji' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN status_emoji TEXT")
        conn.commit()
    if 'status_text' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN status_text TEXT")
        conn.commit()
    # Migration: add profile_bg column to users
    if 'profile_bg' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN profile_bg TEXT")
        conn.commit()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            ts REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS quality_cache (
            title_hash TEXT NOT NULL,
            prompt_hash TEXT NOT NULL,
            verdict TEXT,
            score INTEGER,
            cached_at REAL NOT NULL,
            PRIMARY KEY (title_hash, prompt_hash)
        )
    """)
    conn.executescript("""
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
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS smart_highlights_cache (
            url_hash TEXT PRIMARY KEY,
            highlights_json TEXT NOT NULL,
            cached_at REAL NOT NULL
        )
    """)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS chat_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summary TEXT NOT NULL,
            topics TEXT DEFAULT '',
            page_url TEXT DEFAULT '',
            page_title TEXT DEFAULT '',
            message_count INTEGER DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chatmem_created ON chat_memories(created_at DESC);
    """)
    conn.executescript("""
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
    """)
    conn.commit()
    conn.close()



def log_usage(event):
    conn = _get_db()
    conn.execute("INSERT INTO usage_log (event, ts) VALUES (?, ?)", (event, time.time()))
    conn.commit()
    conn.close()


# Initialize DB on import
init_db()
