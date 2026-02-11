import os
import json
import re
import ssl
import time
import urllib.request
import sqlite3
import secrets
import uuid

import hashlib

DIR = os.environ.get('ARXIV_DATA_DIR', os.path.dirname(os.path.abspath(__file__)))
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, timestamp)
_cache = {}

# Disk-backed feed cache shared across all users / server restarts
FEED_CACHE_DIR = os.path.join(DIR, 'feed_cache')
os.makedirs(FEED_CACHE_DIR, exist_ok=True)

EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')  # legacy — only used for migration
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')

SAVED_CONTENT_DIR = os.path.join(DIR, 'saved_content')
VAULT_DIR = os.path.join(os.path.expanduser('~'), 'Desktop', 'aether')
os.makedirs(SAVED_CONTENT_DIR, exist_ok=True)
os.makedirs(VAULT_DIR, exist_ok=True)


def get_vault_project_dir(google_id, project_id):
    """Resolve a project directory inside the user's vault. Returns path or None if traversal."""
    from vault_helpers import _get_user_vault_path
    vault = _get_user_vault_path(google_id)
    d = os.path.join(vault, project_id)
    if not os.path.realpath(d).startswith(os.path.realpath(vault) + os.sep):
        return None
    return d


def _content_path(url):
    import hashlib
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    return os.path.join(SAVED_CONTENT_DIR, h + '.json')


def read_saved_content(url):
    path = _content_path(url)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return None


def write_saved_content(url, data):
    path = _content_path(url)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def read_blocked_titles():
    if not os.path.exists(BLOCKED_TITLES_FILE):
        return []
    with open(BLOCKED_TITLES_FILE, 'r') as f:
        return json.load(f)


def write_blocked_titles(titles):
    with open(BLOCKED_TITLES_FILE, 'w') as f:
        json.dump(titles, f, indent=2)




def slugify(text):
    s = text.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s or 'experiment'


def unique_vault_slug(vault_path, base):
    """Generate a unique slug within a vault directory."""
    slug = base
    i = 2
    while os.path.exists(os.path.join(vault_path, slug)):
        slug = f'{base}-{i}'
        i += 1
    return slug


def read_prompt():
    """Read the custom prompt from disk, or return None if not set."""
    if os.path.exists(PROMPT_FILE):
        with open(PROMPT_FILE, 'r') as f:
            text = f.read().strip()
            return text if text else None
    return None


def write_prompt(prompt):
    """Write a custom prompt to disk. Pass None/empty to delete."""
    if not prompt or not prompt.strip():
        if os.path.exists(PROMPT_FILE):
            os.remove(PROMPT_FILE)
    else:
        with open(PROMPT_FILE, 'w') as f:
            f.write(prompt.strip())


DEFAULT_VERDICT_PROMPT = (
    "You are a topic filter. Your job is to remove obvious junk from a feed reader.\n\n"
    "SKIP only if the title is clearly about: product reviews, buyer's guides, 'best X' roundups, "
    "deals, discounts, coupons, promo codes, gift guides, price comparisons, sales, "
    "VPN/mattress/sleep product reviews, TV/movie recommendations, recipes, fashion, "
    "celebrity gossip, rage bait, clickbait, SEO spam.\n\n"
    "KEEP everything else — science, technology, programming, news, culture, ideas, sports, "
    "politics, business, and anything that could be genuinely interesting to read.\n\n"
    "When in doubt, KEEP.\n\n"
    "Reply ONLY with KEEP or SKIP."
)


DEFAULT_SCORING_PROMPT = (
    "You are a relevance scorer for a general-interest reader who likes science, tech, ideas, and news.\n\n"
    "90-100: groundbreaking research, major discoveries, novel algorithms, important papers.\n"
    "80-89: significant releases, deep technical write-ups, compelling long-form journalism.\n"
    "70-79: solid content — interesting news, thoughtful analysis, useful tutorials, good discussions.\n"
    "60-69: decent content — general tech/science news, industry updates, opinion pieces with substance.\n"
    "40-59: mediocre — routine announcements, surface-level reporting, mildly interesting.\n"
    "20-39: low quality — listicles, rehashed takes, thin content.\n"
    "1-19: junk — product roundups, deals, SEO content, clickbait, engagement farming.\n"
    "0: spam.\n\n"
    "Be generous with interesting content. Most substantive articles should score 70+.\n\n"
    "Reply with ONLY a number 0-100."
)


def classify_title(title, system_msg=None):
    """Classify a single title as 'keep' or 'skip' via Ollama."""
    if system_msg is None:
        system_msg = DEFAULT_VERDICT_PROMPT
    payload = json.dumps({
        "model": "qwen3:8b",
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": title}
        ],
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": 3}
    }).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp_data = json.loads(resp.read())
    raw = resp_data.get("message", {}).get("content", "").strip()
    return "keep" if raw.upper().startswith("KEEP") else "skip"


def _feed_cache_path(key):
    """Return path for a disk-cached feed entry."""
    h = hashlib.sha256(key.encode()).hexdigest()[:16]
    return os.path.join(FEED_CACHE_DIR, h + '.bin')


def _disk_cache_get(key):
    """Read from disk cache. Returns (data_bytes, timestamp) or None."""
    path = _feed_cache_path(key)
    try:
        if not os.path.exists(path):
            return None
        mtime = os.path.getmtime(path)
        if time.time() - mtime >= CACHE_TTL:
            return None
        with open(path, 'rb') as f:
            return f.read(), mtime
    except Exception:
        return None


def _disk_cache_set(key, data):
    """Write data bytes to disk cache."""
    try:
        with open(_feed_cache_path(key), 'wb') as f:
            f.write(data)
    except Exception:
        pass


def cached_fetch(url, timeout=15):
    """Fetch a URL, returning cached bytes if fresh enough.

    Checks in-memory cache first, then disk cache (shared across users
    and server restarts), then fetches from the network.
    """
    now = time.time()
    # 1) In-memory cache
    if url in _cache:
        data, ts = _cache[url]
        if now - ts < CACHE_TTL:
            return data
    # 2) Disk cache
    disk = _disk_cache_get(url)
    if disk:
        data, ts = disk
        _cache[url] = (data, ts)
        return data
    # 3) Network fetch
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    ctx = ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        data = resp.read()
    _cache[url] = (data, now)
    _disk_cache_set(url, data)
    return data


# ── User accounts (SQLite) ──

DB_PATH = os.path.join(DIR, 'aether.db')
SESSION_TTL = 30 * 24 * 3600  # 30 days


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
    # Teams tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_google_id TEXT NOT NULL REFERENCES users(google_id),
            created TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS team_members (
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            role TEXT NOT NULL DEFAULT 'member',
            joined TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (team_id, google_id)
        );
        CREATE TABLE IF NOT EXISTS team_invites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            from_google_id TEXT NOT NULL,
            to_google_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS experiment_teams (
            experiment_id TEXT NOT NULL,
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            PRIMARY KEY (experiment_id, team_id)
        );
    """)
    # Per-user data tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS experiment_owners (
            experiment_id TEXT PRIMARY KEY,
            google_id TEXT NOT NULL REFERENCES users(google_id)
        );
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
        CREATE TABLE IF NOT EXISTS team_messages (
            id TEXT PRIMARY KEY,
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            content TEXT NOT NULL,
            timestamp REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS team_todos (
            id TEXT PRIMARY KEY,
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            title TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            priority TEXT DEFAULT 'medium',
            assigned_to TEXT,
            description TEXT,
            timestamp REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS team_chat_read (
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            last_read REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (team_id, google_id)
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
    # Migration: add edited column to team_messages
    tm_cols = [r[1] for r in conn.execute("PRAGMA table_info(team_messages)").fetchall()]
    if 'edited' not in tm_cols:
        conn.execute("ALTER TABLE team_messages ADD COLUMN edited INTEGER DEFAULT 0")
        conn.commit()
    # Message reactions table
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS message_reactions (
            message_id TEXT NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            emoji TEXT NOT NULL,
            timestamp REAL NOT NULL,
            PRIMARY KEY (message_id, google_id, emoji)
        );

        CREATE TABLE IF NOT EXISTS reposts (
            id TEXT PRIMARY KEY,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            username TEXT,
            paper_link TEXT NOT NULL,
            paper_title TEXT,
            timestamp REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS blog_votes (
            blog_author TEXT NOT NULL,
            blog_slug TEXT NOT NULL,
            voter_google_id TEXT NOT NULL REFERENCES users(google_id),
            vote INTEGER NOT NULL,
            timestamp REAL NOT NULL,
            PRIMARY KEY (blog_author, blog_slug, voter_google_id)
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
    # Migration: add private and parent_id columns to teams
    team_cols = [r[1] for r in conn.execute("PRAGMA table_info(teams)").fetchall()]
    if 'private' not in team_cols:
        conn.execute("ALTER TABLE teams ADD COLUMN private INTEGER DEFAULT 0")
        conn.commit()
    if 'parent_id' not in team_cols:
        conn.execute("ALTER TABLE teams ADD COLUMN parent_id INTEGER")
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
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS embeddings (
            content_hash TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            title TEXT NOT NULL,
            link TEXT NOT NULL,
            source TEXT DEFAULT '',
            embedding BLOB NOT NULL,
            dim INTEGER NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_emb_type ON embeddings(content_type);
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
            embedding BLOB,
            dim INTEGER DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chatmem_created ON chat_memories(created_at DESC);
    """)
    conn.commit()
    conn.close()


def log_usage(event):
    conn = _get_db()
    conn.execute("INSERT INTO usage_log (event, ts) VALUES (?, ?)", (event, time.time()))
    conn.commit()
    conn.close()


# ── Shared quality filter cache ──

_DEFAULT_PROMPT_HASH = hashlib.sha256(
    (DEFAULT_VERDICT_PROMPT).encode()
).hexdigest()[:16]

_DEFAULT_SCORING_HASH = hashlib.sha256(
    (DEFAULT_SCORING_PROMPT).encode()
).hexdigest()[:16]


def _title_hash(title):
    return hashlib.sha256(title.encode()).hexdigest()[:20]


def quality_cache_get(titles, prompt_hash):
    """Look up cached quality results for a list of titles.
    Returns dict of {title: {verdict, score}} for hits."""
    if not titles:
        return {}
    conn = _get_db()
    results = {}
    for title in titles:
        th = _title_hash(title)
        row = conn.execute(
            "SELECT verdict, score FROM quality_cache WHERE title_hash = ? AND prompt_hash = ?",
            (th, prompt_hash)
        ).fetchone()
        if row:
            results[title] = {'v': row['verdict'], 's': row['score']}
    conn.close()
    return results


def quality_cache_set(entries, prompt_hash):
    """Store quality results. entries = {title: {'v': verdict, 's': score|None}}"""
    if not entries:
        return
    conn = _get_db()
    now = time.time()
    for title, data in entries.items():
        th = _title_hash(title)
        verdict = data.get('v')
        score = data.get('s')
        conn.execute(
            "INSERT OR REPLACE INTO quality_cache (title_hash, prompt_hash, verdict, score, cached_at) VALUES (?, ?, ?, ?, ?)",
            (th, prompt_hash, verdict, score, now)
        )
    conn.commit()
    conn.close()


# ── Smart highlights cache ──

def smart_highlights_get(url):
    """Look up cached smart highlights for a paper URL. Returns parsed JSON or None."""
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:20]
    conn = _get_db()
    row = conn.execute(
        "SELECT highlights_json FROM smart_highlights_cache WHERE url_hash = ?",
        (url_hash,)
    ).fetchone()
    conn.close()
    if row:
        return json.loads(row['highlights_json'])
    return None


def smart_highlights_set(url, data):
    """Store smart highlights for a paper URL."""
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:20]
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO smart_highlights_cache (url_hash, highlights_json, cached_at) VALUES (?, ?, ?)",
        (url_hash, json.dumps(data), time.time())
    )
    conn.commit()
    conn.close()


# ── Semantic embeddings ──

import struct
import math

def _embedding_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()[:20]

def _pack_embedding(vec):
    return struct.pack(f'{len(vec)}f', *vec)

def _unpack_embedding(blob, dim):
    return struct.unpack(f'{dim}f', blob)

def _cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)

def embed_text_ollama(text):
    """Call Ollama embed API with nomic-embed-text. Returns list of floats or None."""
    try:
        payload = json.dumps({"model": "nomic-embed-text", "input": text[:2000]}).encode()
        req = urllib.request.Request(
            "http://localhost:11434/api/embed",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        embeddings = data.get("embeddings")
        if embeddings and len(embeddings) > 0:
            return embeddings[0]
        return None
    except Exception:
        return None

def store_embedding(text, title, link, source='', content_type='post'):
    """Embed text and store in DB. Skips if already exists."""
    ch = _embedding_hash(text)
    conn = _get_db()
    exists = conn.execute("SELECT 1 FROM embeddings WHERE content_hash = ?", (ch,)).fetchone()
    if exists:
        conn.close()
        return True
    vec = embed_text_ollama(text)
    if not vec:
        conn.close()
        return False
    blob = _pack_embedding(vec)
    conn.execute(
        "INSERT OR IGNORE INTO embeddings (content_hash, content_type, title, link, source, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (ch, content_type, title, link, source, blob, len(vec), time.time())
    )
    conn.commit()
    conn.close()
    return True

def search_embeddings(query_vec, content_type=None, limit=20, exclude_link=None):
    """Brute-force cosine search over all embeddings. Returns top N {title, link, source, score}."""
    conn = _get_db()
    if content_type:
        rows = conn.execute("SELECT title, link, source, embedding, dim FROM embeddings WHERE content_type = ?", (content_type,)).fetchall()
    else:
        rows = conn.execute("SELECT title, link, source, embedding, dim FROM embeddings").fetchall()
    conn.close()
    results = []
    for row in rows:
        if exclude_link and row['link'] == exclude_link:
            continue
        vec = _unpack_embedding(row['embedding'], row['dim'])
        score = _cosine_similarity(query_vec, vec)
        results.append({'title': row['title'], 'link': row['link'], 'source': row['source'], 'score': round(score, 4)})
    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:limit]


def store_chat_memory(summary, topics, page_url='', page_title='', message_count=0):
    """Embed a chat summary and store in chat_memories table."""
    vec = embed_text_ollama(summary)
    blob = _pack_embedding(vec) if vec else None
    dim = len(vec) if vec else 0
    conn = _get_db()
    conn.execute(
        "INSERT INTO chat_memories (summary, topics, page_url, page_title, message_count, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (summary, topics, page_url, page_title, message_count, blob, dim, time.time())
    )
    conn.commit()
    conn.close()


def search_chat_memories(query_vec, limit=3):
    """Cosine search over recent chat memories. Returns top N {id, summary, topics, page_title, score}."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, summary, topics, page_title, embedding, dim FROM chat_memories WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    results = []
    for row in rows:
        vec = _unpack_embedding(row['embedding'], row['dim'])
        score = _cosine_similarity(query_vec, vec)
        results.append({
            'id': row['id'],
            'summary': row['summary'],
            'topics': row['topics'],
            'page_title': row['page_title'],
            'score': round(score, 4)
        })
    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:limit]


def list_chat_memories(limit=50, offset=0):
    """List chat memories ordered by recency. Returns {memories: [...], total: N}."""
    conn = _get_db()
    total = conn.execute("SELECT COUNT(*) FROM chat_memories").fetchone()[0]
    rows = conn.execute(
        "SELECT id, summary, topics, page_title, page_url, message_count, created_at FROM chat_memories ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset)
    ).fetchall()
    conn.close()
    return {
        'memories': [dict(r) for r in rows],
        'total': total
    }


def delete_chat_memory(memory_id):
    """Delete a single chat memory by id."""
    conn = _get_db()
    conn.execute("DELETE FROM chat_memories WHERE id = ?", (memory_id,))
    conn.commit()
    conn.close()


def get_memory_stats():
    """Aggregate stats: total count, date range, top 10 topics."""
    conn = _get_db()
    row = conn.execute(
        "SELECT COUNT(*) as cnt, MIN(created_at) as oldest, MAX(created_at) as newest FROM chat_memories"
    ).fetchone()
    total = row['cnt']
    oldest = row['oldest']
    newest = row['newest']
    # Aggregate topics
    topic_rows = conn.execute("SELECT topics FROM chat_memories WHERE topics IS NOT NULL AND topics != ''").fetchall()
    conn.close()
    freq = {}
    for tr in topic_rows:
        for t in tr['topics'].split(','):
            t = t.strip().lower()
            if t:
                freq[t] = freq.get(t, 0) + 1
    top_topics = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:10]
    return {
        'total_count': total,
        'oldest_ts': oldest,
        'newest_ts': newest,
        'top_topics': [{'topic': t, 'count': c} for t, c in top_topics]
    }


def pairwise_similarities(links, threshold=0.65):
    """Compute pairwise cosine similarities for a set of links that have embeddings.
    Returns list of { source, target, score } for pairs above threshold. Cap at 300 links."""
    links = links[:300]
    conn = _get_db()
    placeholders = ','.join('?' for _ in links)
    rows = conn.execute(
        f"SELECT link, embedding, dim FROM embeddings WHERE link IN ({placeholders})",
        links
    ).fetchall()
    conn.close()
    vecs = {}
    for row in rows:
        vecs[row['link']] = _unpack_embedding(row['embedding'], row['dim'])
    keys = list(vecs.keys())
    edges = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            score = _cosine_similarity(vecs[keys[i]], vecs[keys[j]])
            if score >= threshold:
                edges.append({'source': keys[i], 'target': keys[j], 'score': round(score, 4)})
    return edges


def get_usage_history(days=30):
    conn = _get_db()
    since = time.time() - days * 86400
    rows = conn.execute(
        "SELECT event, ts FROM usage_log WHERE ts > ? ORDER BY ts", (since,)
    ).fetchall()
    conn.close()
    from collections import defaultdict
    by_day = defaultdict(lambda: defaultdict(int))
    for r in rows:
        day = time.strftime('%Y-%m-%d', time.localtime(r['ts']))
        by_day[day][r['event']] += 1
    return dict(by_day)


def upsert_google_user(google_id, email, name, picture=None):
    conn = _get_db()
    row = conn.execute("SELECT google_id FROM users WHERE google_id = ?", (google_id,)).fetchone()
    if row:
        conn.execute(
            "UPDATE users SET email = ?, name = ?, picture = ? WHERE google_id = ?",
            (email, name, picture, google_id)
        )
    else:
        conn.execute(
            "INSERT INTO users (google_id, email, name, picture, created) VALUES (?, ?, ?, ?, ?)",
            (google_id, email, name, picture, time.time())
        )
    conn.commit()
    conn.close()
    return google_id


def get_user_info(google_id):
    conn = _get_db()
    row = conn.execute("SELECT google_id, email, name, username, picture, profile_private, status_emoji, status_text FROM users WHERE google_id = ?", (google_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {'google_id': row['google_id'], 'email': row['email'], 'name': row['name'], 'username': row['username'], 'picture': row['picture'], 'profile_private': bool(row['profile_private']), 'status_emoji': row['status_emoji'], 'status_text': row['status_text']}


def set_username(google_id, username):
    """Set username for a user. Returns True on success, False if taken (case-insensitive)."""
    conn = _get_db()
    try:
        conn.execute("UPDATE users SET username = ? WHERE google_id = ?", (username, google_id))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def delete_user(google_id):
    """Delete a user and all their data. Returns list of owned experiment_ids for filesystem cleanup."""
    conn = _get_db()
    # Get owned experiments for filesystem cleanup
    owned_exps = [r['experiment_id'] for r in conn.execute(
        "SELECT experiment_id FROM experiment_owners WHERE google_id = ?", (google_id,)
    ).fetchall()]
    # Get teams owned by this user
    owned_teams = [r['id'] for r in conn.execute(
        "SELECT id FROM teams WHERE owner_google_id = ?", (google_id,)
    ).fetchall()]
    # Delete per-user data
    conn.execute("DELETE FROM message_reactions WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM calendar_events WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM comments WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM experiment_owners WHERE google_id = ?", (google_id,))
    # Delete owned teams and their related data
    for tid in owned_teams:
        conn.execute("DELETE FROM experiment_teams WHERE team_id = ?", (tid,))
        conn.execute("DELETE FROM team_invites WHERE team_id = ?", (tid,))
        conn.execute("DELETE FROM team_members WHERE team_id = ?", (tid,))
        conn.execute("DELETE FROM teams WHERE id = ?", (tid,))
    # Remove from teams where just a member
    conn.execute("DELETE FROM team_members WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM team_invites WHERE from_google_id = ? OR to_google_id = ?", (google_id, google_id))
    # Core user data
    conn.execute("DELETE FROM user_data WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM sessions WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM users WHERE google_id = ?", (google_id,))
    conn.commit()
    conn.close()
    return owned_exps


def create_session(google_id):
    token = secrets.token_urlsafe(32)
    expires = time.time() + SESSION_TTL
    conn = _get_db()
    conn.execute(
        "INSERT INTO sessions (token, google_id, expires) VALUES (?, ?, ?)",
        (token, google_id, expires)
    )
    conn.commit()
    conn.close()
    return token


def get_session_user(token):
    if not token:
        return None
    conn = _get_db()
    row = conn.execute(
        "SELECT google_id, expires FROM sessions WHERE token = ?", (token,)
    ).fetchone()
    conn.close()
    if not row or row['expires'] < time.time():
        return None
    return row['google_id']


def delete_session(token):
    conn = _get_db()
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def get_all_user_data(google_id):
    conn = _get_db()
    rows = conn.execute(
        "SELECT key, value, updated FROM user_data WHERE google_id = ?", (google_id,)
    ).fetchall()
    conn.close()
    result = {}
    for row in rows:
        try:
            result[row['key']] = {'value': json.loads(row['value']), 'updated': row['updated']}
        except json.JSONDecodeError:
            result[row['key']] = {'value': row['value'], 'updated': row['updated']}
    return result


def get_user_data(google_id, key):
    """Get a single user data value by key. Returns None if not found."""
    conn = _get_db()
    row = conn.execute(
        "SELECT value FROM user_data WHERE google_id = ? AND key = ?", (google_id, key)
    ).fetchone()
    conn.close()
    if not row:
        return None
    try:
        return json.loads(row['value'])
    except json.JSONDecodeError:
        return row['value']


def set_user_data(google_id, key, value, updated=None):
    if updated is None:
        updated = time.time()
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES (?, ?, ?, ?)",
        (google_id, key, json.dumps(value), updated)
    )
    conn.commit()
    conn.close()


def set_user_data_bulk(google_id, data):
    """data is dict of {key: {value, updated}}"""
    conn = _get_db()
    for key, entry in data.items():
        value = entry.get('value')
        updated = entry.get('updated', time.time())
        conn.execute(
            "INSERT OR REPLACE INTO user_data (google_id, key, value, updated) VALUES (?, ?, ?, ?)",
            (google_id, key, json.dumps(value), updated)
        )
    conn.commit()
    conn.close()


# ── Teams ──

def create_team(name, owner_google_id, private=0, parent_id=None):
    conn = _get_db()
    cur = conn.execute(
        "INSERT INTO teams (name, owner_google_id, private, parent_id) VALUES (?, ?, ?, ?)",
        (name, owner_google_id, 1 if private else 0, parent_id)
    )
    team_id = cur.lastrowid
    conn.execute(
        "INSERT INTO team_members (team_id, google_id, role) VALUES (?, ?, 'owner')",
        (team_id, owner_google_id)
    )
    conn.commit()
    conn.close()
    return team_id


def get_user_teams(google_id):
    conn = _get_db()
    rows = conn.execute("""
        SELECT t.id, t.name, t.private, t.parent_id, tm.role,
               (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
        FROM teams t
        JOIN team_members tm ON tm.team_id = t.id AND tm.google_id = ?
        ORDER BY t.name
    """, (google_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'name': r['name'], 'private': bool(r['private']), 'parent_id': r['parent_id'], 'role': r['role'], 'member_count': r['member_count']} for r in rows]


def get_team(team_id):
    conn = _get_db()
    team = conn.execute("SELECT id, name, owner_google_id, created, private, parent_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team:
        conn.close()
        return None
    members = conn.execute("""
        SELECT tm.google_id, u.username, u.picture, tm.role
        FROM team_members tm
        JOIN users u ON u.google_id = tm.google_id
        WHERE tm.team_id = ?
        ORDER BY tm.role DESC, u.username
    """, (team_id,)).fetchall()
    conn.close()
    return {
        'id': team['id'],
        'name': team['name'],
        'owner_google_id': team['owner_google_id'],
        'created': team['created'],
        'private': bool(team['private']),
        'parent_id': team['parent_id'],
        'members': [{'google_id': m['google_id'], 'username': m['username'], 'picture': m['picture'], 'role': m['role']} for m in members]
    }


def delete_team(team_id, google_id):
    conn = _get_db()
    team = conn.execute("SELECT owner_google_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team or team['owner_google_id'] != google_id:
        conn.close()
        return False
    conn.execute("DELETE FROM experiment_teams WHERE team_id = ?", (team_id,))
    conn.execute("DELETE FROM team_invites WHERE team_id = ?", (team_id,))
    conn.execute("DELETE FROM team_members WHERE team_id = ?", (team_id,))
    conn.execute("DELETE FROM teams WHERE id = ?", (team_id,))
    conn.commit()
    conn.close()
    return True


def rename_team(team_id, new_name, google_id):
    conn = _get_db()
    team = conn.execute("SELECT owner_google_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team or team['owner_google_id'] != google_id:
        conn.close()
        return False
    conn.execute("UPDATE teams SET name = ? WHERE id = ?", (new_name, team_id))
    conn.commit()
    conn.close()
    return True


def get_user_public_teams(google_id, viewer_google_id=None):
    conn = _get_db()
    rows = conn.execute("""
        SELECT t.id, t.name, t.private,
               (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
        FROM teams t
        JOIN team_members tm ON tm.team_id = t.id AND tm.google_id = ?
        ORDER BY t.name
    """, (google_id,)).fetchall()
    conn.close()
    result = []
    for r in rows:
        if r['private'] and viewer_google_id:
            # Only show private teams if viewer is also a member
            conn2 = _get_db()
            is_member = conn2.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (r['id'], viewer_google_id)
            ).fetchone()
            conn2.close()
            if not is_member:
                continue
        elif r['private']:
            continue
        result.append({'id': r['id'], 'name': r['name'], 'member_count': r['member_count'], 'private': bool(r['private'])})
    return result


def invite_to_team(team_id, from_google_id, to_username):
    conn = _get_db()
    # Check team exists and inviter is a member
    member = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
        (team_id, from_google_id)
    ).fetchone()
    if not member:
        conn.close()
        return {'error': 'Not a team member'}
    # Look up target user by username (case-insensitive)
    target = conn.execute(
        "SELECT google_id FROM users WHERE lower(username) = ?",
        (to_username.lower(),)
    ).fetchone()
    if not target:
        conn.close()
        return {'error': 'Username not found'}
    to_google_id = target['google_id']
    # Check already a member
    existing = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
        (team_id, to_google_id)
    ).fetchone()
    if existing:
        conn.close()
        return {'error': 'Already a team member'}
    # Check for existing pending invite
    pending = conn.execute(
        "SELECT 1 FROM team_invites WHERE team_id = ? AND to_google_id = ? AND status = 'pending'",
        (team_id, to_google_id)
    ).fetchone()
    if pending:
        conn.close()
        return {'error': 'Invite already pending'}
    conn.execute(
        "INSERT INTO team_invites (team_id, from_google_id, to_google_id) VALUES (?, ?, ?)",
        (team_id, from_google_id, to_google_id)
    )
    conn.commit()
    conn.close()
    return {'ok': True}


def get_pending_invites(google_id):
    conn = _get_db()
    rows = conn.execute("""
        SELECT ti.id, t.name AS team_name, u.username AS from_username, ti.created
        FROM team_invites ti
        JOIN teams t ON t.id = ti.team_id
        JOIN users u ON u.google_id = ti.from_google_id
        WHERE ti.to_google_id = ? AND ti.status = 'pending'
        ORDER BY ti.created DESC
    """, (google_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'team_name': r['team_name'], 'from_username': r['from_username'], 'created': r['created']} for r in rows]


def respond_to_invite(invite_id, google_id, accept):
    conn = _get_db()
    invite = conn.execute(
        "SELECT team_id, to_google_id FROM team_invites WHERE id = ? AND status = 'pending'",
        (invite_id,)
    ).fetchone()
    if not invite or invite['to_google_id'] != google_id:
        conn.close()
        return False
    if accept:
        conn.execute(
            "INSERT OR IGNORE INTO team_members (team_id, google_id, role) VALUES (?, ?, 'member')",
            (invite['team_id'], google_id)
        )
        conn.execute("UPDATE team_invites SET status = 'accepted' WHERE id = ?", (invite_id,))
    else:
        conn.execute("UPDATE team_invites SET status = 'declined' WHERE id = ?", (invite_id,))
    conn.commit()
    conn.close()
    return True


def remove_team_member(team_id, owner_google_id, target_google_id):
    conn = _get_db()
    team = conn.execute("SELECT owner_google_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team or team['owner_google_id'] != owner_google_id:
        conn.close()
        return False
    if target_google_id == owner_google_id:
        conn.close()
        return False
    conn.execute(
        "DELETE FROM team_members WHERE team_id = ? AND google_id = ?",
        (team_id, target_google_id)
    )
    conn.commit()
    conn.close()
    return True


# ── Legacy experiment ownership (kept for migration) ──

def get_user_experiment_ids(google_id):
    """Return set of experiment_ids the user owns (legacy DB). Used only for migration."""
    conn = _get_db()
    owned = conn.execute(
        "SELECT experiment_id FROM experiment_owners WHERE google_id = ?",
        (google_id,)
    ).fetchall()
    conn.close()
    return set(r['experiment_id'] for r in owned)


# ── Calendar (per-user) ──

def get_user_calendar(google_id):
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, title, date, description, color FROM calendar_events WHERE google_id = ? ORDER BY date",
        (google_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_calendar_event(google_id, data):
    import uuid
    eid = str(uuid.uuid4())
    conn = _get_db()
    conn.execute(
        "INSERT INTO calendar_events (id, google_id, title, date, description, color) VALUES (?, ?, ?, ?, ?, ?)",
        (eid, google_id, data['title'], data.get('date', ''), data.get('description', ''), data.get('color', '#b4451a'))
    )
    conn.commit()
    conn.close()
    return {'id': eid, 'title': data['title'], 'date': data.get('date', ''), 'description': data.get('description', ''), 'color': data.get('color', '#b4451a')}


def update_calendar_event(google_id, eid, updates):
    conn = _get_db()
    row = conn.execute(
        "SELECT id FROM calendar_events WHERE id = ? AND google_id = ?",
        (eid, google_id)
    ).fetchone()
    if not row:
        conn.close()
        return None
    allowed = ('title', 'date', 'description', 'color')
    sets = []
    vals = []
    for k in allowed:
        if k in updates:
            sets.append(f"{k} = ?")
            vals.append(updates[k])
    if sets:
        vals.append(eid)
        conn.execute(f"UPDATE calendar_events SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    result = conn.execute("SELECT id, title, date, description, color FROM calendar_events WHERE id = ?", (eid,)).fetchone()
    conn.close()
    return dict(result) if result else None


def delete_calendar_event(google_id, eid):
    conn = _get_db()
    cur = conn.execute(
        "DELETE FROM calendar_events WHERE id = ? AND google_id = ?",
        (eid, google_id)
    )
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted


# ── Todos (per-user) ──



# ── Comments (shared, but auth for write/delete) ──

def db_get_comments(paper_link=None):
    conn = _get_db()
    if paper_link:
        rows = conn.execute(
            "SELECT * FROM comments WHERE paper_link = ? ORDER BY timestamp",
            (paper_link,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM comments ORDER BY timestamp").fetchall()
    conn.close()
    return [_comment_row_to_dict(r) for r in rows]


def _comment_row_to_dict(r):
    return {
        'id': r['id'], 'paperLink': r['paper_link'], 'author': r['author'] or 'Anonymous',
        'content': r['content'], 'timestamp': r['timestamp'], 'parentId': r['parent_id']
    }


def db_create_comment(google_id, data):
    import uuid
    cid = str(uuid.uuid4())
    conn = _get_db()
    ts = int(time.time() * 1000)
    conn.execute(
        "INSERT INTO comments (id, paper_link, google_id, author, content, timestamp, parent_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (cid, data['paperLink'], google_id, data.get('author', 'Anonymous'),
         data['content'], ts, data.get('parentId'))
    )
    conn.commit()
    conn.close()
    return {
        'id': cid, 'paperLink': data['paperLink'], 'author': data.get('author', 'Anonymous'),
        'content': data['content'], 'timestamp': ts, 'parentId': data.get('parentId')
    }


def db_delete_comment(google_id, cid):
    conn = _get_db()
    # Only delete if user owns the comment
    row = conn.execute(
        "SELECT id FROM comments WHERE id = ? AND google_id = ?",
        (cid, google_id)
    ).fetchone()
    if not row:
        conn.close()
        return False
    # Remove comment and all replies
    to_remove = {cid}
    changed = True
    all_comments = conn.execute("SELECT id, parent_id FROM comments").fetchall()
    while changed:
        changed = False
        for c in all_comments:
            if c['parent_id'] in to_remove and c['id'] not in to_remove:
                to_remove.add(c['id'])
                changed = True
    placeholders = ','.join('?' for _ in to_remove)
    conn.execute(f"DELETE FROM comments WHERE id IN ({placeholders})", list(to_remove))
    conn.commit()
    conn.close()
    return True


# ── User Profiles (public) ──

def touch_last_seen(google_id):
    conn = _get_db()
    conn.execute("UPDATE users SET last_seen = ? WHERE google_id = ?", (time.time(), google_id))
    conn.commit()
    conn.close()


def update_user_status(google_id, emoji, text):
    conn = _get_db()
    conn.execute("UPDATE users SET status_emoji = ?, status_text = ? WHERE google_id = ?",
                 (emoji or None, text or None, google_id))
    conn.commit()
    conn.close()


def get_user_feed_sources(google_id):
    """Read feedSources and customFeeds from user_data for a given user."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT key, value FROM user_data WHERE google_id = ? AND key IN ('feedSources', 'customFeeds')",
        (google_id,)
    ).fetchall()
    conn.close()
    result = {'feedSources': {}, 'customFeeds': []}
    for row in rows:
        try:
            result[row['key']] = json.loads(row['value'])
        except (json.JSONDecodeError, ValueError):
            pass
    return result


def get_public_user_info(username):
    """Case-insensitive lookup. Returns {username, picture, created, profile_private, profile_bg, last_seen, status_emoji, status_text} or None."""
    conn = _get_db()
    row = conn.execute(
        "SELECT google_id, username, picture, created, profile_private, profile_bg, last_seen, status_emoji, status_text FROM users WHERE lower(username) = ?",
        (username.lower(),)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {
        'google_id': row['google_id'],
        'username': row['username'],
        'picture': row['picture'],
        'created': row['created'],
        'profile_private': bool(row['profile_private']),
        'profile_bg': row['profile_bg'],
        'last_seen': row['last_seen'],
        'status_emoji': row['status_emoji'],
        'status_text': row['status_text'],
    }


def get_user_public_stats(google_id):
    """Returns {comment_count, team_count, experiment_count}."""
    conn = _get_db()
    comment_count = conn.execute(
        "SELECT COUNT(*) as c FROM comments WHERE google_id = ?", (google_id,)
    ).fetchone()['c']
    team_count = conn.execute(
        "SELECT COUNT(*) as c FROM team_members WHERE google_id = ?", (google_id,)
    ).fetchone()['c']
    experiment_count = conn.execute(
        "SELECT COUNT(*) as c FROM experiment_owners WHERE google_id = ?", (google_id,)
    ).fetchone()['c']
    repost_count = conn.execute(
        "SELECT COUNT(*) as c FROM reposts WHERE google_id = ?", (google_id,)
    ).fetchone()['c']
    conn.close()
    return {
        'comment_count': comment_count,
        'team_count': team_count,
        'experiment_count': experiment_count,
        'repost_count': repost_count
    }


def get_user_recent_comments(google_id, limit=20):
    """Returns list of {id, paper_link, content, author, timestamp} ordered by timestamp DESC."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, paper_link, content, author, timestamp FROM comments WHERE google_id = ? ORDER BY timestamp DESC LIMIT ?",
        (google_id, limit)
    ).fetchall()
    conn.close()
    return [{'id': r['id'], 'paperLink': r['paper_link'], 'content': r['content'],
             'author': r['author'], 'timestamp': r['timestamp']} for r in rows]


def create_repost(google_id, username, paper_link, paper_title):
    conn = _get_db()
    repost_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO reposts (id, google_id, username, paper_link, paper_title, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (repost_id, google_id, username, paper_link, paper_title, time.time() * 1000)
    )
    conn.commit()
    conn.close()
    return {'id': repost_id, 'paperLink': paper_link, 'paperTitle': paper_title,
            'username': username, 'timestamp': time.time() * 1000}


def get_user_reposts(google_id, limit=20):
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, paper_link, paper_title, username, timestamp FROM reposts WHERE google_id = ? ORDER BY timestamp DESC LIMIT ?",
        (google_id, limit)
    ).fetchall()
    conn.close()
    return [{'id': r['id'], 'paperLink': r['paper_link'], 'paperTitle': r['paper_title'],
             'username': r['username'], 'timestamp': r['timestamp']} for r in rows]


def delete_repost(google_id, paper_link):
    conn = _get_db()
    conn.execute("DELETE FROM reposts WHERE google_id = ? AND paper_link = ?", (google_id, paper_link))
    conn.commit()
    conn.close()
    return True


# ── Blog Votes ──

def set_blog_vote(blog_author, blog_slug, voter_google_id, vote):
    """Set a vote (+1 upvote, -1 downvote, 0 to remove). Returns new vote counts."""
    conn = _get_db()
    if vote == 0:
        conn.execute(
            "DELETE FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND voter_google_id = ?",
            (blog_author, blog_slug, voter_google_id)
        )
    else:
        conn.execute(
            "INSERT OR REPLACE INTO blog_votes (blog_author, blog_slug, voter_google_id, vote, timestamp) VALUES (?, ?, ?, ?, ?)",
            (blog_author, blog_slug, voter_google_id, vote, time.time())
        )
    conn.commit()
    # Get new totals
    up = conn.execute(
        "SELECT COUNT(*) FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = 1",
        (blog_author, blog_slug)
    ).fetchone()[0]
    down = conn.execute(
        "SELECT COUNT(*) FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = -1",
        (blog_author, blog_slug)
    ).fetchone()[0]
    conn.close()
    return {'upvotes': up, 'downvotes': down}


def get_blog_votes(blog_author, blog_slug, viewer_google_id=None):
    """Get vote counts and optionally the viewer's vote."""
    conn = _get_db()
    up = conn.execute(
        "SELECT COUNT(*) FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = 1",
        (blog_author, blog_slug)
    ).fetchone()[0]
    down = conn.execute(
        "SELECT COUNT(*) FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = -1",
        (blog_author, blog_slug)
    ).fetchone()[0]
    user_vote = 0
    if viewer_google_id:
        row = conn.execute(
            "SELECT vote FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND voter_google_id = ?",
            (blog_author, blog_slug, viewer_google_id)
        ).fetchone()
        if row:
            user_vote = row[0]
    conn.close()
    return {'upvotes': up, 'downvotes': down, 'userVote': user_vote}


# ── Achievements ──

# Achievement definitions
ACHIEVEMENTS = {
    'first_blog': {
        'id': 'first_blog',
        'name': 'First Post',
        'description': 'Published your first blog post',
        'icon': '📝',
    },
    'prolific_writer': {
        'id': 'prolific_writer',
        'name': 'Prolific Writer',
        'description': 'Published 10 blog posts',
        'icon': '✍️',
    },
    'first_note': {
        'id': 'first_note',
        'name': 'Note Taker',
        'description': 'Created your first note',
        'icon': '📓',
    },
    'vault_master': {
        'id': 'vault_master',
        'name': 'Vault Master',
        'description': 'Created 50 notes',
        'icon': '🗄️',
    },
    'first_status': {
        'id': 'first_status',
        'name': 'Statusphere',
        'description': 'Set your first status',
        'icon': '💬',
    },
    'pet_adopter': {
        'id': 'pet_adopter',
        'name': 'Pet Parent',
        'description': 'Adopted a pixel pet',
        'icon': '🐾',
    },
    'gaze_master': {
        'id': 'gaze_master',
        'name': 'Gaze Master',
        'description': 'Trained your eye-tracking model 5 times',
        'icon': '👁️',
    },
}


def get_user_achievements(google_id):
    """Get all achievements for a user."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT achievement_id, unlocked_at FROM achievements WHERE google_id = ? ORDER BY unlocked_at DESC",
        (google_id,)
    ).fetchall()
    conn.close()
    result = []
    for row in rows:
        ach_id = row['achievement_id']
        if ach_id in ACHIEVEMENTS:
            result.append({
                **ACHIEVEMENTS[ach_id],
                'unlocked_at': row['unlocked_at']
            })
    return result


def grant_achievement(google_id, achievement_id):
    """Grant an achievement to a user. Returns the achievement if newly granted, None if already had it."""
    if achievement_id not in ACHIEVEMENTS:
        return None
    conn = _get_db()
    # Check if already has it
    existing = conn.execute(
        "SELECT 1 FROM achievements WHERE google_id = ? AND achievement_id = ?",
        (google_id, achievement_id)
    ).fetchone()
    if existing:
        conn.close()
        return None
    # Grant it
    unlocked_at = time.time()
    conn.execute(
        "INSERT INTO achievements (google_id, achievement_id, unlocked_at) VALUES (?, ?, ?)",
        (google_id, achievement_id, unlocked_at)
    )
    conn.commit()
    conn.close()
    return {**ACHIEVEMENTS[achievement_id], 'unlocked_at': unlocked_at}


def has_achievement(google_id, achievement_id):
    """Check if user has a specific achievement."""
    conn = _get_db()
    row = conn.execute(
        "SELECT 1 FROM achievements WHERE google_id = ? AND achievement_id = ?",
        (google_id, achievement_id)
    ).fetchone()
    conn.close()
    return row is not None


def get_user_shared_experiments(viewer_google_id, target_google_id):
    """Stub — experiments are now in vault, not DB-tracked."""
    return []


def search_users(query, limit=10):
    """Search users by username prefix. Returns list of {username, picture}. Excludes private profiles."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT username, picture FROM users WHERE username IS NOT NULL AND profile_private = 0 AND username LIKE ? LIMIT ?",
        (query + '%', limit)
    ).fetchall()
    conn.close()
    return [{'username': r['username'], 'picture': r['picture']} for r in rows]


def list_users(limit=50):
    """Return all users with a username, newest first. Excludes private profiles."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT username, picture, created FROM users WHERE username IS NOT NULL AND profile_private = 0 ORDER BY created DESC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    return [{'username': r['username'], 'picture': r['picture'], 'created': r['created']} for r in rows]


# ── Direct Messages ──

def send_direct_message(from_google_id, to_google_id, content):
    import uuid
    mid = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    conn = _get_db()
    conn.execute(
        "INSERT INTO direct_messages (id, from_google_id, to_google_id, content, timestamp) VALUES (?, ?, ?, ?, ?)",
        (mid, from_google_id, to_google_id, content, ts)
    )
    conn.commit()
    conn.close()
    return {'id': mid, 'from_google_id': from_google_id, 'to_google_id': to_google_id,
            'content': content, 'timestamp': ts, 'read': False}


def get_direct_messages(google_id):
    """Get all messages sent to this user, newest first."""
    conn = _get_db()
    rows = conn.execute("""
        SELECT dm.id, dm.from_google_id, dm.content, dm.timestamp, dm.read, u.username, u.picture
        FROM direct_messages dm
        JOIN users u ON u.google_id = dm.from_google_id
        WHERE dm.to_google_id = ?
        ORDER BY dm.timestamp DESC
    """, (google_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'from_username': r['username'], 'from_picture': r['picture'],
             'content': r['content'], 'timestamp': r['timestamp'], 'read': bool(r['read'])} for r in rows]


def mark_message_read(google_id, message_id):
    conn = _get_db()
    conn.execute(
        "UPDATE direct_messages SET read = 1 WHERE id = ? AND to_google_id = ?",
        (message_id, google_id)
    )
    conn.commit()
    conn.close()


def delete_direct_message(google_id, message_id):
    conn = _get_db()
    cur = conn.execute(
        "DELETE FROM direct_messages WHERE id = ? AND to_google_id = ?",
        (message_id, google_id)
    )
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted


def get_unread_message_count(google_id):
    conn = _get_db()
    count = conn.execute(
        "SELECT COUNT(*) as c FROM direct_messages WHERE to_google_id = ? AND read = 0",
        (google_id,)
    ).fetchone()['c']
    conn.close()
    return count


def get_user_by_username(username):
    """Look up google_id by username (case-insensitive)."""
    conn = _get_db()
    row = conn.execute(
        "SELECT google_id FROM users WHERE lower(username) = ?",
        (username.lower(),)
    ).fetchone()
    conn.close()
    return row['google_id'] if row else None


# ── Message Reactions ──

def toggle_reaction(message_id, google_id, emoji):
    conn = _get_db()
    existing = conn.execute(
        "SELECT 1 FROM message_reactions WHERE message_id = ? AND google_id = ? AND emoji = ?",
        (message_id, google_id, emoji)
    ).fetchone()
    if existing:
        conn.execute(
            "DELETE FROM message_reactions WHERE message_id = ? AND google_id = ? AND emoji = ?",
            (message_id, google_id, emoji)
        )
        added = False
    else:
        conn.execute(
            "INSERT INTO message_reactions (message_id, google_id, emoji, timestamp) VALUES (?, ?, ?, ?)",
            (message_id, google_id, emoji, time.time() * 1000)
        )
        added = True
    conn.commit()
    reactions = get_message_reactions(conn, message_id)
    conn.close()
    return {'added': added, 'reactions': reactions}


def get_message_reactions(conn, message_id):
    rows = conn.execute("""
        SELECT mr.emoji, mr.google_id, u.username
        FROM message_reactions mr
        JOIN users u ON u.google_id = mr.google_id
        WHERE mr.message_id = ?
        ORDER BY mr.timestamp ASC
    """, (message_id,)).fetchall()
    grouped = {}
    for r in rows:
        emoji = r['emoji']
        if emoji not in grouped:
            grouped[emoji] = {'emoji': emoji, 'count': 0, 'users': []}
        grouped[emoji]['count'] += 1
        grouped[emoji]['users'].append({'google_id': r['google_id'], 'username': r['username']})
    return list(grouped.values())


def get_messages_reactions_bulk(conn, message_ids):
    if not message_ids:
        return {}
    placeholders = ','.join('?' for _ in message_ids)
    rows = conn.execute(f"""
        SELECT mr.message_id, mr.emoji, mr.google_id, u.username
        FROM message_reactions mr
        JOIN users u ON u.google_id = mr.google_id
        WHERE mr.message_id IN ({placeholders})
        ORDER BY mr.timestamp ASC
    """, message_ids).fetchall()
    result = {}
    for r in rows:
        mid = r['message_id']
        emoji = r['emoji']
        if mid not in result:
            result[mid] = {}
        if emoji not in result[mid]:
            result[mid][emoji] = {'emoji': emoji, 'count': 0, 'users': []}
        result[mid][emoji]['count'] += 1
        result[mid][emoji]['users'].append({'google_id': r['google_id'], 'username': r['username']})
    return {mid: list(emojis.values()) for mid, emojis in result.items()}


# ── Team Messages ──

def send_team_message(team_id, google_id, content):
    import uuid
    mid = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    conn = _get_db()
    conn.execute(
        "INSERT INTO team_messages (id, team_id, google_id, content, timestamp) VALUES (?, ?, ?, ?, ?)",
        (mid, team_id, google_id, content, ts)
    )
    conn.commit()
    conn.close()
    return {'id': mid, 'team_id': team_id, 'google_id': google_id,
            'content': content, 'timestamp': ts}


def get_team_messages(team_id, limit=50):
    conn = _get_db()
    rows = conn.execute("""
        SELECT tm.id, tm.google_id, tm.content, tm.timestamp, tm.edited, u.username, u.picture
        FROM team_messages tm
        JOIN users u ON u.google_id = tm.google_id
        WHERE tm.team_id = ?
        ORDER BY tm.timestamp ASC
        LIMIT ?
    """, (team_id, limit)).fetchall()
    messages = [{'id': r['id'], 'username': r['username'], 'picture': r['picture'],
                 'content': r['content'], 'timestamp': r['timestamp'],
                 'google_id': r['google_id'], 'edited': bool(r['edited'])} for r in rows]
    # Attach reactions
    msg_ids = [m['id'] for m in messages]
    reactions_map = get_messages_reactions_bulk(conn, msg_ids) if msg_ids else {}
    conn.close()
    for m in messages:
        m['reactions'] = reactions_map.get(m['id'], [])
    return messages


def update_team_message(team_id, message_id, google_id, content):
    conn = _get_db()
    cur = conn.execute(
        "UPDATE team_messages SET content = ?, edited = 1 WHERE id = ? AND team_id = ? AND google_id = ?",
        (content, message_id, team_id, google_id)
    )
    conn.commit()
    updated = cur.rowcount > 0
    conn.close()
    return updated


def delete_team_message(team_id, message_id, google_id):
    conn = _get_db()
    cur = conn.execute(
        "DELETE FROM team_messages WHERE id = ? AND team_id = ? AND google_id = ?",
        (message_id, team_id, google_id)
    )
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted


def mark_team_chat_read(team_id, google_id):
    conn = _get_db()
    ts = int(time.time() * 1000)
    conn.execute(
        "INSERT INTO team_chat_read (team_id, google_id, last_read) VALUES (?, ?, ?) "
        "ON CONFLICT(team_id, google_id) DO UPDATE SET last_read = ?",
        (team_id, google_id, ts, ts)
    )
    conn.commit()
    conn.close()


def get_unread_team_chats(google_id):
    """Get recent unread team chat messages across all teams the user is in (excluding own messages)."""
    conn = _get_db()
    rows = conn.execute("""
        SELECT tm.id, tm.team_id, tm.google_id, tm.content, tm.timestamp,
               u.username, u.picture, t.name AS team_name,
               COALESCE(tcr.last_read, 0) AS last_read
        FROM team_messages tm
        JOIN team_members tmem ON tmem.team_id = tm.team_id AND tmem.google_id = ?
        JOIN users u ON u.google_id = tm.google_id
        JOIN teams t ON t.id = tm.team_id
        LEFT JOIN team_chat_read tcr ON tcr.team_id = tm.team_id AND tcr.google_id = ?
        WHERE tm.google_id != ?
          AND tm.timestamp > COALESCE(tcr.last_read, 0)
        ORDER BY tm.timestamp DESC
        LIMIT 50
    """, (google_id, google_id, google_id)).fetchall()
    conn.close()
    return [{'id': r['id'], 'team_id': r['team_id'], 'content': r['content'],
             'timestamp': r['timestamp'], 'username': r['username'],
             'picture': r['picture'], 'team_name': r['team_name']} for r in rows]


def get_unread_team_chat_count(google_id):
    conn = _get_db()
    count = conn.execute("""
        SELECT COUNT(*) as c
        FROM team_messages tm
        JOIN team_members tmem ON tmem.team_id = tm.team_id AND tmem.google_id = ?
        LEFT JOIN team_chat_read tcr ON tcr.team_id = tm.team_id AND tcr.google_id = ?
        WHERE tm.google_id != ?
          AND tm.timestamp > COALESCE(tcr.last_read, 0)
    """, (google_id, google_id, google_id)).fetchone()['c']
    conn.close()
    return count


# ── Team Todos ──

def get_team_todos(team_id):
    conn = _get_db()
    rows = conn.execute("""
        SELECT tt.id, tt.team_id, tt.google_id, tt.title, tt.done, tt.priority,
               tt.assigned_to, tt.description, tt.timestamp, u.username, u.picture,
               ua.username AS assigned_username
        FROM team_todos tt
        JOIN users u ON u.google_id = tt.google_id
        LEFT JOIN users ua ON ua.google_id = tt.assigned_to
        WHERE tt.team_id = ?
        ORDER BY tt.done ASC, tt.timestamp DESC
    """, (team_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'team_id': r['team_id'], 'google_id': r['google_id'],
             'title': r['title'], 'done': bool(r['done']), 'priority': r['priority'] or 'medium',
             'assigned_to': r['assigned_to'], 'assigned_username': r['assigned_username'],
             'description': r['description'] or '', 'timestamp': r['timestamp'],
             'author': r['username'], 'author_picture': r['picture']} for r in rows]


def create_team_todo(team_id, google_id, data):
    import uuid
    tid = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    conn = _get_db()
    conn.execute(
        "INSERT INTO team_todos (id, team_id, google_id, title, done, priority, assigned_to, description, timestamp) "
        "VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
        (tid, team_id, google_id, data['title'], data.get('priority', 'medium'),
         data.get('assigned_to'), data.get('description', ''), ts)
    )
    conn.commit()
    conn.close()
    return {'id': tid, 'team_id': team_id, 'google_id': google_id,
            'title': data['title'], 'done': False, 'priority': data.get('priority', 'medium'),
            'assigned_to': data.get('assigned_to'), 'description': data.get('description', ''),
            'timestamp': ts}


def update_team_todo(team_id, todo_id, updates):
    conn = _get_db()
    row = conn.execute(
        "SELECT id FROM team_todos WHERE id = ? AND team_id = ?",
        (todo_id, team_id)
    ).fetchone()
    if not row:
        conn.close()
        return None
    allowed = {'title': 'title', 'done': 'done', 'priority': 'priority',
               'assigned_to': 'assigned_to', 'description': 'description'}
    sets = []
    vals = []
    for js_key, db_col in allowed.items():
        if js_key in updates:
            sets.append(f"{db_col} = ?")
            val = updates[js_key]
            if db_col == 'done':
                val = 1 if val else 0
            vals.append(val)
    if sets:
        vals.append(todo_id)
        vals.append(team_id)
        conn.execute(f"UPDATE team_todos SET {', '.join(sets)} WHERE id = ? AND team_id = ?", vals)
        conn.commit()
    conn.close()
    return {'ok': True}


def delete_team_todo(team_id, todo_id):
    conn = _get_db()
    cur = conn.execute(
        "DELETE FROM team_todos WHERE id = ? AND team_id = ?",
        (todo_id, team_id)
    )
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted


def get_my_assigned_todos(google_id):
    """Get all open team todos assigned to this user, across all teams."""
    conn = _get_db()
    rows = conn.execute("""
        SELECT tt.id, tt.team_id, tt.google_id, tt.title, tt.done, tt.priority,
               tt.assigned_to, tt.description, tt.timestamp,
               u.username AS author, t.name AS team_name
        FROM team_todos tt
        JOIN users u ON u.google_id = tt.google_id
        JOIN teams t ON t.id = tt.team_id
        WHERE tt.assigned_to = ? AND tt.done = 0
        ORDER BY
            CASE tt.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
            tt.timestamp DESC
    """, (google_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'team_id': r['team_id'], 'title': r['title'],
             'done': bool(r['done']), 'priority': r['priority'] or 'medium',
             'description': r['description'] or '', 'timestamp': r['timestamp'],
             'author': r['author'], 'team_name': r['team_name']} for r in rows]


# ── Profile & Team Privacy ──

def update_user_picture(google_id, picture_url):
    conn = _get_db()
    conn.execute("UPDATE users SET picture = ? WHERE google_id = ?", (picture_url, google_id))
    conn.commit()
    conn.close()


def update_user_profile_bg(google_id, bg_url):
    conn = _get_db()
    conn.execute("UPDATE users SET profile_bg = ? WHERE google_id = ?", (bg_url, google_id))
    conn.commit()
    conn.close()


def get_user_accent_color(google_id):
    """Read the user's accent color from the synced user_data table."""
    conn = _get_db()
    row = conn.execute(
        "SELECT value FROM user_data WHERE google_id = ? AND key = 'accentColor'",
        (google_id,)
    ).fetchone()
    conn.close()
    if not row:
        return '#b4451a'
    try:
        return json.loads(row['value'])
    except (json.JSONDecodeError, ValueError):
        return '#b4451a'


def set_profile_private(google_id, private):
    conn = _get_db()
    conn.execute("UPDATE users SET profile_private = ? WHERE google_id = ?", (1 if private else 0, google_id))
    conn.commit()
    conn.close()


def are_teammates(gid_a, gid_b):
    """Check if two users share any team membership."""
    conn = _get_db()
    row = conn.execute("""
        SELECT 1 FROM team_members tm1
        JOIN team_members tm2 ON tm1.team_id = tm2.team_id
        WHERE tm1.google_id = ? AND tm2.google_id = ?
        LIMIT 1
    """, (gid_a, gid_b)).fetchone()
    conn.close()
    return bool(row)


def set_team_private(team_id, private, google_id):
    """Owner-only toggle for team privacy."""
    conn = _get_db()
    team = conn.execute("SELECT owner_google_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team or team['owner_google_id'] != google_id:
        conn.close()
        return False
    conn.execute("UPDATE teams SET private = ? WHERE id = ?", (1 if private else 0, team_id))
    conn.commit()
    conn.close()
    return True


def set_team_parent(team_id, parent_id, google_id):
    """Owner-only set parent team. Returns False if not owner or circular reference."""
    conn = _get_db()
    team = conn.execute("SELECT owner_google_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team or team['owner_google_id'] != google_id:
        conn.close()
        return False
    # Check circular reference by walking the parent chain
    if parent_id is not None:
        visited = {team_id}
        current = parent_id
        depth = 0
        while current is not None and depth < 10:
            if current in visited:
                conn.close()
                return False
            visited.add(current)
            row = conn.execute("SELECT parent_id FROM teams WHERE id = ?", (current,)).fetchone()
            if not row:
                break
            current = row['parent_id']
            depth += 1
    conn.execute("UPDATE teams SET parent_id = ? WHERE id = ?", (parent_id, team_id))
    conn.commit()
    conn.close()
    return True


def get_team_children(team_id):
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, name, private FROM teams WHERE parent_id = ? ORDER BY name",
        (team_id,)
    ).fetchall()
    conn.close()
    return [{'id': r['id'], 'name': r['name'], 'private': bool(r['private'])} for r in rows]


def get_team_ancestors(team_id):
    """Walk parent chain up to 10 levels. Returns list from root to immediate parent."""
    conn = _get_db()
    ancestors = []
    current = team_id
    depth = 0
    while depth < 10:
        row = conn.execute("SELECT id, name, parent_id FROM teams WHERE id = ?", (current,)).fetchone()
        if not row or row['parent_id'] is None:
            break
        parent = conn.execute("SELECT id, name, parent_id FROM teams WHERE id = ?", (row['parent_id'],)).fetchone()
        if not parent:
            break
        ancestors.append({'id': parent['id'], 'name': parent['name']})
        current = parent['id']
        depth += 1
    conn.close()
    ancestors.reverse()
    return ancestors


def rewrite_proxy_html(html_str, base_url):
    """Rewrite relative URLs in proxied HTML for non-Electron browser mode (CORS proxy).
    Returns processed HTML string."""
    from html.parser import HTMLParser
    from urllib.parse import urljoin, urlparse

    output = []

    class ProxyRewriter(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attrs_dict = dict(attrs)

            # Rewrite relative URLs to absolute
            for url_attr in ('src', 'href', 'action', 'poster'):
                if url_attr in attrs_dict and attrs_dict[url_attr]:
                    val = attrs_dict[url_attr]
                    if not val.startswith(('http://', 'https://', 'data:', 'javascript:', '#', 'mailto:')):
                        attrs_dict[url_attr] = urljoin(base_url, val)

            # Rewrite <img> src through image proxy so images are same-origin
            if tag == 'img' and 'src' in attrs_dict:
                img_src = attrs_dict['src']
                if img_src.startswith(('http://', 'https://')) and not img_src.startswith(('http://localhost', 'https://localhost')):
                    from urllib.parse import quote as _url_quote
                    attrs_dict['src'] = '/api/image-proxy?url=' + _url_quote(img_src, safe='')
            if tag in ('img', 'source') and 'srcset' in attrs_dict:
                import re as _re
                def _rewrite_srcset_entry(m):
                    url = m.group(1)
                    rest = m.group(2)
                    if url.startswith(('http://', 'https://')) and not url.startswith(('http://localhost', 'https://localhost')):
                        from urllib.parse import quote as _url_quote2
                        return '/api/image-proxy?url=' + _url_quote2(url, safe='') + rest
                    return m.group(0)
                attrs_dict['srcset'] = _re.sub(r'(\S+)(\s+[^,]*)', _rewrite_srcset_entry, attrs_dict['srcset'])

            # Rewrite same-origin <a> links to go through proxy
            if tag == 'a' and 'href' in attrs_dict:
                href = attrs_dict['href']
                try:
                    parsed_base = urlparse(base_url)
                    parsed_href = urlparse(href)
                    if parsed_href.hostname and parsed_href.hostname == parsed_base.hostname:
                        from urllib.parse import quote as _url_quote
                        attrs_dict['href'] = '/api/browse-proxy?url=' + _url_quote(href, safe='')
                except Exception:
                    pass

            attr_str = ''
            for k, v in attrs_dict.items():
                if v is None:
                    attr_str += f' {k}'
                else:
                    attr_str += f' {k}="{v}"'
            output.append(f'<{tag}{attr_str}>')

        def handle_endtag(self, tag):
            output.append(f'</{tag}>')

        def handle_data(self, data):
            output.append(data)

        def handle_comment(self, data):
            output.append(f'<!--{data}-->')

        def handle_decl(self, decl):
            output.append(f'<!{decl}>')

        def handle_pi(self, data):
            output.append(f'<?{data}>')

        def handle_startendtag(self, tag, attrs):
            attrs_dict = dict(attrs)
            for url_attr in ('src', 'href'):
                if url_attr in attrs_dict and attrs_dict[url_attr]:
                    val = attrs_dict[url_attr]
                    if not val.startswith(('http://', 'https://', 'data:', 'javascript:', '#', 'mailto:')):
                        attrs_dict[url_attr] = urljoin(base_url, val)
            attr_str = ''
            for k, v in attrs_dict.items():
                if v is None:
                    attr_str += f' {k}'
                else:
                    attr_str += f' {k}="{v}"'
            output.append(f'<{tag}{attr_str}/>')

    parser = ProxyRewriter(convert_charrefs=False)
    parser.feed(html_str)

    # Inject link context menu script for non-Electron mode
    link_popup_script = """<script>console.log('[aether] link menu script loaded');</script>
<style>
.aether-link-menu{position:fixed;z-index:999999;background:rgba(40,40,40,.98);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px 0;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;min-width:220px}
.alm-item{padding:6px 12px;color:rgba(255,255,255,.9);cursor:default;white-space:nowrap;border-radius:4px;margin:0 4px}
.alm-item:hover{background:rgba(255,255,255,.1)}
.alm-sep{height:1px;background:rgba(255,255,255,.1);margin:4px 8px}
</style>
<script>
(function(){
var m=null,u='',t='';
function hide(){if(m){m.remove();m=null}}
function show(e,href,txt){
  hide();u=href;t=txt||'';
  m=document.createElement('div');
  m.className='aether-link-menu';
  var s=t.length>25?t.slice(0,22)+'...':t;
  m.innerHTML='<div class="alm-item" data-a="newtab">Open Link in New Tab</div>'+
    '<div class="alm-item" data-a="here">Open Link Here</div>'+
    '<div class="alm-sep"></div>'+
    '<div class="alm-item" data-a="copy">Copy Link Address</div>'+
    (t?'<div class="alm-item" data-a="copytext">Copy Link Text</div><div class="alm-sep"></div><div class="alm-item" data-a="search">Search Google for "'+s.replace(/"/g,'&quot;')+'"</div>':'');
  m.style.left=e.clientX+'px';m.style.top=e.clientY+'px';
  document.body.appendChild(m);
  var r=m.getBoundingClientRect();
  if(r.right>window.innerWidth)m.style.left=(window.innerWidth-r.width-8)+'px';
  if(r.bottom>window.innerHeight)m.style.top=(window.innerHeight-r.height-8)+'px';
  m.onclick=function(ev){
    var i=ev.target.closest('.alm-item');if(!i)return;
    var a=i.dataset.a;
    if(a==='newtab')window.open(u,'_blank');
    else if(a==='here')location.href=u;
    else if(a==='copy')navigator.clipboard.writeText(u).catch(function(){});
    else if(a==='copytext')navigator.clipboard.writeText(t).catch(function(){});
    else if(a==='search')window.open('https://www.google.com/search?q='+encodeURIComponent(t),'_blank');
    hide();
  };
}
document.addEventListener('click',function(e){
  var a=e.target.closest('a[href]');
  if(a){
    var h=a.getAttribute('href');
    if(h&&h.indexOf('javascript:')!==0&&h.charAt(0)!=='#'){
      e.preventDefault();e.stopPropagation();
      show(e,h,a.textContent.trim());
      return false;
    }
  }
  hide();
},true);
document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});
})();
</script>"""

    return link_popup_script + ''.join(output)


# ── Reference Cache (persistent) ──

def get_cached_references(arxiv_id):
    """Get cached references for a paper. Returns list of references or None."""
    conn = _get_db()
    row = conn.execute(
        "SELECT references_json FROM reference_cache WHERE arxiv_id = ?",
        (arxiv_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    try:
        return json.loads(row['references_json'])
    except (json.JSONDecodeError, ValueError):
        return None


def set_cached_references(arxiv_id, references):
    """Cache references for a paper (persistent, no TTL — references don't change)."""
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO reference_cache (arxiv_id, references_json, cached_at) VALUES (?, ?, ?)",
        (arxiv_id, json.dumps(references), time.time())
    )
    conn.commit()
    conn.close()


# ── Author Cache (persistent, stats refreshed daily) ──

AUTHOR_CACHE_STATS_TTL = 86400  # 24 hours — refresh stats once a day


def get_cached_author(query):
    """Get cached author data. Returns (author_dict, needs_refresh) or (None, True).
    needs_refresh is True if cached_at is older than 24 hours (stats may be stale)."""
    conn = _get_db()
    row = conn.execute(
        "SELECT author_json, cached_at FROM author_cache WHERE query = ?",
        (query.lower().strip(),)
    ).fetchone()
    conn.close()
    if not row:
        return None, True
    try:
        data = json.loads(row['author_json'])
        stale = (time.time() - row['cached_at']) > AUTHOR_CACHE_STATS_TTL
        return data, stale
    except (json.JSONDecodeError, ValueError):
        return None, True


def set_cached_author(query, author_data):
    """Cache author data."""
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO author_cache (query, author_json, cached_at) VALUES (?, ?, ?)",
        (query.lower().strip(), json.dumps(author_data), time.time())
    )
    conn.commit()
    conn.close()


# Initialize DB on import
init_db()
