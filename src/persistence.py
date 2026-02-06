import os
import json
import re
import ssl
import time
import urllib.request
import sqlite3
import secrets
import uuid

DIR = os.environ.get('ARXIV_DATA_DIR', os.path.dirname(os.path.abspath(__file__)))
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, timestamp)
_cache = {}

EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')

SAVED_CONTENT_DIR = os.path.join(DIR, 'saved_content')
VAULT_DIR = os.path.join(os.path.expanduser('~'), 'Desktop', 'alpha')
os.makedirs(EXPERIMENTS_DIR, exist_ok=True)
os.makedirs(SAVED_CONTENT_DIR, exist_ok=True)
os.makedirs(VAULT_DIR, exist_ok=True)


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


def unique_slug(base):
    slug = base
    i = 2
    while os.path.exists(os.path.join(EXPERIMENTS_DIR, slug)):
        slug = f'{base}-{i}'
        i += 1
    return slug


def read_meta(exp_id):
    path = os.path.join(EXPERIMENTS_DIR, exp_id, 'meta.json')
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)


def write_meta(exp_id, data):
    path = os.path.join(EXPERIMENTS_DIR, exp_id, 'meta.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


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


def get_active_prompt():
    """Return the custom prompt if set, otherwise the default."""
    return read_prompt() or DEFAULT_VERDICT_PROMPT


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
        "model": "qwen2.5:7b",
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": title}
        ],
        "stream": False,
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


def cached_fetch(url, timeout=15):
    """Fetch a URL, returning cached bytes if fresh enough."""
    now = time.time()
    if url in _cache:
        data, ts = _cache[url]
        if now - ts < CACHE_TTL:
            return data
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    ctx = ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        data = resp.read()
    _cache[url] = (data, now)
    return data


# ── User accounts (SQLite) ──

DB_PATH = os.path.join(DIR, 'lookup.db')
SESSION_TTL = 30 * 24 * 3600  # 30 days


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
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
        CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            google_id TEXT NOT NULL REFERENCES users(google_id),
            title TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            date TEXT,
            description TEXT,
            content TEXT,
            color TEXT,
            experiment_id TEXT,
            paper_link TEXT
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
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")
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
    conn.commit()
    conn.close()


def log_usage(event):
    conn = _get_db()
    conn.execute("INSERT INTO usage_log (event, ts) VALUES (?, ?)", (event, time.time()))
    conn.commit()
    conn.close()


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
        # Check case-insensitive uniqueness (excluding self)
        row = conn.execute(
            "SELECT google_id FROM users WHERE lower(username) = ? AND google_id != ?",
            (username.lower(), google_id)
        ).fetchone()
        if row:
            conn.close()
            return False
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
    conn.execute("DELETE FROM todos WHERE google_id = ?", (google_id,))
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


def set_experiment_team(experiment_id, team_id, google_id):
    conn = _get_db()
    member = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
        (team_id, google_id)
    ).fetchone()
    if not member:
        conn.close()
        return False
    # Remove existing team assignment for this experiment
    conn.execute("DELETE FROM experiment_teams WHERE experiment_id = ?", (experiment_id,))
    conn.execute(
        "INSERT INTO experiment_teams (experiment_id, team_id) VALUES (?, ?)",
        (experiment_id, team_id)
    )
    conn.commit()
    conn.close()
    return True


def remove_experiment_team(experiment_id):
    conn = _get_db()
    conn.execute("DELETE FROM experiment_teams WHERE experiment_id = ?", (experiment_id,))
    conn.commit()
    conn.close()


def get_experiment_team(experiment_id):
    conn = _get_db()
    row = conn.execute(
        "SELECT team_id FROM experiment_teams WHERE experiment_id = ?",
        (experiment_id,)
    ).fetchone()
    conn.close()
    return row['team_id'] if row else None


def get_team_experiments(team_id):
    conn = _get_db()
    rows = conn.execute(
        "SELECT experiment_id FROM experiment_teams WHERE team_id = ?",
        (team_id,)
    ).fetchall()
    conn.close()
    return [r['experiment_id'] for r in rows]


# ── Experiment Ownership ──

def set_experiment_owner(experiment_id, google_id):
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO experiment_owners (experiment_id, google_id) VALUES (?, ?)",
        (experiment_id, google_id)
    )
    conn.commit()
    conn.close()


def get_experiment_owner(experiment_id):
    conn = _get_db()
    row = conn.execute(
        "SELECT google_id FROM experiment_owners WHERE experiment_id = ?",
        (experiment_id,)
    ).fetchone()
    conn.close()
    return row['google_id'] if row else None


def get_user_experiment_ids(google_id):
    """Return set of experiment_ids the user owns or has access to via teams."""
    conn = _get_db()
    owned = conn.execute(
        "SELECT experiment_id FROM experiment_owners WHERE google_id = ?",
        (google_id,)
    ).fetchall()
    team_exps = conn.execute("""
        SELECT et.experiment_id FROM experiment_teams et
        JOIN team_members tm ON tm.team_id = et.team_id
        WHERE tm.google_id = ?
    """, (google_id,)).fetchall()
    conn.close()
    return set(r['experiment_id'] for r in owned) | set(r['experiment_id'] for r in team_exps)


def user_can_access_experiment(experiment_id, google_id):
    """Check if user owns or has team access to an experiment."""
    conn = _get_db()
    owned = conn.execute(
        "SELECT 1 FROM experiment_owners WHERE experiment_id = ? AND google_id = ?",
        (experiment_id, google_id)
    ).fetchone()
    if owned:
        conn.close()
        return True
    team_access = conn.execute("""
        SELECT 1 FROM experiment_teams et
        JOIN team_members tm ON tm.team_id = et.team_id
        WHERE et.experiment_id = ? AND tm.google_id = ?
    """, (experiment_id, google_id)).fetchone()
    conn.close()
    return bool(team_access)


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

def get_user_todos(google_id, paper_link=None):
    conn = _get_db()
    if paper_link:
        rows = conn.execute(
            "SELECT * FROM todos WHERE google_id = ? AND paper_link = ?",
            (google_id, paper_link)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM todos WHERE google_id = ?",
            (google_id,)
        ).fetchall()
    conn.close()
    return [_todo_row_to_dict(r) for r in rows]


def _todo_row_to_dict(r):
    return {
        'id': r['id'], 'title': r['title'], 'done': bool(r['done']),
        'date': r['date'] or '', 'description': r['description'] or '',
        'content': r['content'] or '', 'color': r['color'] or '#b4451a',
        'experimentId': r['experiment_id'], 'paperLink': r['paper_link']
    }


def create_todo(google_id, data):
    import uuid
    tid = str(uuid.uuid4())
    conn = _get_db()
    conn.execute(
        "INSERT INTO todos (id, google_id, title, done, date, description, content, color, experiment_id, paper_link) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (tid, google_id, data['title'], 0, data.get('date', ''), data.get('description', ''),
         data.get('content', ''), data.get('color', '#b4451a'),
         data.get('experimentId'), data.get('paperLink'))
    )
    conn.commit()
    conn.close()
    return {
        'id': tid, 'title': data['title'], 'done': False,
        'date': data.get('date', ''), 'description': data.get('description', ''),
        'content': data.get('content', ''), 'color': data.get('color', '#b4451a'),
        'experimentId': data.get('experimentId'), 'paperLink': data.get('paperLink')
    }


def update_todo(google_id, tid, updates):
    conn = _get_db()
    row = conn.execute(
        "SELECT id FROM todos WHERE id = ? AND google_id = ?",
        (tid, google_id)
    ).fetchone()
    if not row:
        conn.close()
        return None
    allowed = {'title': 'title', 'done': 'done', 'date': 'date', 'description': 'description',
               'content': 'content', 'color': 'color', 'experimentId': 'experiment_id', 'paperLink': 'paper_link'}
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
        vals.append(tid)
        conn.execute(f"UPDATE todos SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    result = conn.execute("SELECT * FROM todos WHERE id = ?", (tid,)).fetchone()
    conn.close()
    return _todo_row_to_dict(result) if result else None


def delete_todo(google_id, tid):
    conn = _get_db()
    cur = conn.execute(
        "DELETE FROM todos WHERE id = ? AND google_id = ?",
        (tid, google_id)
    )
    conn.commit()
    deleted = cur.rowcount > 0
    conn.close()
    return deleted


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
    """Returns experiment_ids that target owns AND are shared via a team where viewer is also a member."""
    conn = _get_db()
    rows = conn.execute("""
        SELECT DISTINCT eo.experiment_id
        FROM experiment_owners eo
        JOIN experiment_teams et ON et.experiment_id = eo.experiment_id
        JOIN team_members tm_target ON tm_target.team_id = et.team_id AND tm_target.google_id = ?
        JOIN team_members tm_viewer ON tm_viewer.team_id = et.team_id AND tm_viewer.google_id = ?
        WHERE eo.google_id = ?
    """, (target_google_id, viewer_google_id, target_google_id)).fetchall()
    conn.close()
    return [r['experiment_id'] for r in rows]


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


# ── Ad Block (Brave adblock-rust via Python bindings) ──

ADBLOCK_ENGINE_FILE = os.path.join(DIR, 'adblock_engine.dat')
ADBLOCK_META_FILE = os.path.join(DIR, 'adblock_meta.json')
ADBLOCK_FILTER_LISTS = [
    ('EasyList', 'https://easylist.to/easylist/easylist.txt'),
    ('EasyPrivacy', 'https://easylist.to/easylist/easyprivacy.txt'),
]

_adblock_engine = None
_adblock_meta = None


def _read_adblock_meta():
    global _adblock_meta
    if _adblock_meta is not None:
        return _adblock_meta
    if os.path.exists(ADBLOCK_META_FILE):
        try:
            with open(ADBLOCK_META_FILE, 'r') as f:
                _adblock_meta = json.load(f)
                return _adblock_meta
        except (json.JSONDecodeError, ValueError):
            pass
    return None


def _write_adblock_meta(meta):
    global _adblock_meta
    _adblock_meta = meta
    with open(ADBLOCK_META_FILE, 'w') as f:
        json.dump(meta, f, indent=2)


def _get_adblock_engine():
    """Lazy-load the Brave adblock engine. Tries deserialize first, then downloads lists."""
    global _adblock_engine
    if _adblock_engine is not None:
        return _adblock_engine
    try:
        import adblock
    except ImportError:
        print("[adblock] adblock package not installed, ad blocking disabled")
        return None
    # Try loading serialized engine from disk
    if os.path.exists(ADBLOCK_ENGINE_FILE):
        try:
            engine = adblock.Engine(adblock.FilterSet())
            engine.deserialize_from_file(ADBLOCK_ENGINE_FILE)
            _adblock_engine = engine
            print(f"[adblock] Loaded engine from {ADBLOCK_ENGINE_FILE}")
            return engine
        except Exception as e:
            print(f"[adblock] Failed to deserialize engine: {e}")
    # Build fresh engine by downloading filter lists
    return update_adblock_lists()


def update_adblock_lists():
    """Download filter lists, build engine, serialize to disk. Returns engine or None."""
    global _adblock_engine
    try:
        import adblock
    except ImportError:
        print("[adblock] adblock package not installed")
        return None
    fs = adblock.FilterSet()
    total_rules = 0
    list_names = []
    ctx = ssl._create_unverified_context()
    for name, url in ADBLOCK_FILTER_LISTS:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                text = resp.read().decode('utf-8', errors='replace')
            rule_count = len([l for l in text.splitlines() if l.strip() and not l.startswith('!')])
            fs.add_filter_list(text, format='standard')
            total_rules += rule_count
            list_names.append(name)
            print(f"[adblock] Loaded {name}: ~{rule_count} rules")
        except Exception as e:
            print(f"[adblock] Failed to download {name} ({url}): {e}")
    engine = adblock.Engine(fs)
    try:
        engine.serialize_to_file(ADBLOCK_ENGINE_FILE)
        print(f"[adblock] Serialized engine to {ADBLOCK_ENGINE_FILE}")
    except Exception as e:
        print(f"[adblock] Failed to serialize engine: {e}")
    _write_adblock_meta({
        'lists': list_names,
        'ruleCount': total_rules,
        'updatedAt': time.time(),
    })
    _adblock_engine = engine
    return engine


def get_adblock_stats():
    """Return info about the current adblock engine for the settings UI."""
    meta = _read_adblock_meta()
    if meta:
        return meta
    return {'lists': [], 'ruleCount': 0, 'updatedAt': None}


def clean_html(html_str, base_url, color_scheme=''):
    """Strip ads, trackers, and sponsored content from HTML using Brave adblock-rust.
    Returns (cleaned_html, blocked_count)."""
    from html.parser import HTMLParser
    from urllib.parse import urljoin, urlparse

    engine = _get_adblock_engine()

    # Map HTML tag context to adblock request types
    _tag_request_type = {
        'script': 'script',
        'img': 'image',
        'iframe': 'subdocument',
        'video': 'media',
        'audio': 'media',
        'source': 'media',
        'object': 'object',
        'embed': 'object',
    }

    def _url_blocked(url, tag='other'):
        if not engine or not url:
            return False
        try:
            req_type = _tag_request_type.get(tag, 'other')
            result = engine.check_network_urls(url, base_url, req_type)
            return result.matched
        except Exception:
            return False

    def _link_blocked(href, rel=''):
        """Check if a <link> element should be blocked."""
        if not engine or not href:
            return False
        try:
            req_type = 'stylesheet' if 'stylesheet' in rel else 'other'
            result = engine.check_network_urls(href, base_url, req_type)
            return result.matched
        except Exception:
            return False

    # Get cosmetic hide selectors from engine
    cosmetic_selectors = set()
    if engine:
        try:
            cr = engine.url_cosmetic_resources(base_url)
            cosmetic_selectors = cr.hide_selectors or set()
        except Exception:
            pass

    blocked_count = 0
    output = []
    skip_depth = 0
    skip_tag = None

    class AdBlockParser(HTMLParser):
        nonlocal blocked_count, skip_depth, skip_tag

        def handle_starttag(self, tag, attrs):
            nonlocal blocked_count, skip_depth, skip_tag
            attrs_dict = dict(attrs)

            if skip_depth > 0:
                skip_depth += 1
                return

            # Block scripts/iframes/img with ad sources
            if tag in ('script', 'iframe', 'img', 'video', 'audio', 'source', 'object', 'embed'):
                src = attrs_dict.get('src', '')
                if src and _url_blocked(src, tag):
                    blocked_count += 1
                    skip_depth = 1
                    skip_tag = tag
                    return

            # Block <link> elements (stylesheets, etc.)
            if tag == 'link':
                href = attrs_dict.get('href', '')
                rel = attrs_dict.get('rel', '')
                if href and _link_blocked(href, rel):
                    blocked_count += 1
                    skip_depth = 1
                    skip_tag = tag
                    return

            # Rewrite relative URLs to absolute
            for url_attr in ('src', 'href', 'action', 'poster'):
                if url_attr in attrs_dict and attrs_dict[url_attr]:
                    val = attrs_dict[url_attr]
                    if not val.startswith(('http://', 'https://', 'data:', 'javascript:', '#', 'mailto:')):
                        attrs_dict[url_attr] = urljoin(base_url, val)

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

            # Reconstruct tag
            attr_str = ''
            for k, v in attrs_dict.items():
                if v is None:
                    attr_str += f' {k}'
                else:
                    attr_str += f' {k}="{v}"'
            output.append(f'<{tag}{attr_str}>')

        def handle_endtag(self, tag):
            nonlocal skip_depth, skip_tag
            if skip_depth > 0:
                skip_depth -= 1
                return
            output.append(f'</{tag}>')

        def handle_data(self, data):
            if skip_depth > 0:
                return
            output.append(data)

        def handle_comment(self, data):
            if skip_depth > 0:
                return
            output.append(f'<!--{data}-->')

        def handle_decl(self, decl):
            output.append(f'<!{decl}>')

        def handle_pi(self, data):
            output.append(f'<?{data}>')

        def handle_startendtag(self, tag, attrs):
            nonlocal blocked_count
            if skip_depth > 0:
                return
            attrs_dict = dict(attrs)
            src_or_href = attrs_dict.get('src', '') or attrs_dict.get('href', '')
            if tag in ('img', 'link') and src_or_href:
                if tag == 'link':
                    rel = attrs_dict.get('rel', '')
                    if _link_blocked(src_or_href, rel):
                        blocked_count += 1
                        return
                elif _url_blocked(src_or_href, tag):
                    blocked_count += 1
                    return
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

    parser = AdBlockParser(convert_charrefs=False)
    parser.feed(html_str)

    # Inject cosmetic CSS to hide ad elements (from engine + generic selectors)
    cosmetic = ''
    if cosmetic_selectors:
        css_rules = ', '.join(cosmetic_selectors)
        cosmetic = f'<style>{css_rules} {{ display: none !important; }}</style>'
    # Inject blocked count as meta tag
    meta = f'<meta name="adblock-count" content="{blocked_count}">'

    # Inject color-scheme preference so pages adapt to dark/light mode
    scheme_injection = ''
    if color_scheme in ('dark', 'light'):
        scheme_injection = (
            f'<meta name="color-scheme" content="{color_scheme}">'
            f'<style>:root {{ color-scheme: {color_scheme}; }}</style>'
            '<script>'
            '(function(){'
            f'var s="{color_scheme}";'
            'var orig=window.matchMedia;'
            'window.matchMedia=function(q){'
            'var r=orig.call(window,q);'
            'if(q==="(prefers-color-scheme: dark)"||q==="(prefers-color-scheme:dark)"){'
            'return Object.defineProperty(Object.create(r),\"matches\",{get:function(){return s===\"dark\"}})'
            '}'
            'if(q==="(prefers-color-scheme: light)"||q==="(prefers-color-scheme:light)"){'
            'return Object.defineProperty(Object.create(r),\"matches\",{get:function(){return s===\"light\"}})'
            '}'
            'return r;};'
            '})();'
            '</script>'
        )

    # Inject link context menu script - shows options on link click
    link_popup_script = """<script>console.log('[alpha] link menu script loaded');</script>
<style>
.alpha-link-menu{position:fixed;z-index:999999;background:rgba(40,40,40,.98);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px 0;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;min-width:220px}
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
  m.className='alpha-link-menu';
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

    result = meta + scheme_injection + cosmetic + link_popup_script + ''.join(output)
    return result, blocked_count


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
