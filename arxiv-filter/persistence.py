import os
import json
import re
import ssl
import time
import urllib.request
import sqlite3
import secrets

DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, timestamp)
_cache = {}

EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')
CALENDAR_FILE = os.path.join(DIR, 'calendar.json')
TODOS_FILE = os.path.join(DIR, 'todos.json')
SAVED_POSTS_FILE = os.path.join(DIR, 'saved_posts.json')
SETTINGS_FILE = os.path.join(DIR, 'settings.json')
COMMENTS_FILE = os.path.join(DIR, 'comments.json')

SAVED_CONTENT_DIR = os.path.join(DIR, 'saved_content')
os.makedirs(EXPERIMENTS_DIR, exist_ok=True)
os.makedirs(SAVED_CONTENT_DIR, exist_ok=True)


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


def read_calendar():
    if not os.path.exists(CALENDAR_FILE):
        return []
    with open(CALENDAR_FILE, 'r') as f:
        return json.load(f)


def write_calendar(events):
    with open(CALENDAR_FILE, 'w') as f:
        json.dump(events, f, indent=2)


def read_todos():
    if not os.path.exists(TODOS_FILE):
        return []
    with open(TODOS_FILE, 'r') as f:
        return json.load(f)


def write_todos(todos):
    with open(TODOS_FILE, 'w') as f:
        json.dump(todos, f, indent=2)


def read_saved_posts():
    if not os.path.exists(SAVED_POSTS_FILE):
        return {}
    try:
        with open(SAVED_POSTS_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return {}


def write_saved_posts(data):
    tmp = SAVED_POSTS_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SAVED_POSTS_FILE)


def read_settings():
    if not os.path.exists(SETTINGS_FILE):
        return {}
    with open(SETTINGS_FILE, 'r') as f:
        return json.load(f)


def write_settings(data):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def read_comments():
    if not os.path.exists(COMMENTS_FILE):
        return []
    try:
        with open(COMMENTS_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return []


def write_comments(comments):
    tmp = COMMENTS_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(comments, f, indent=2)
    os.replace(tmp, COMMENTS_FILE)


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

DB_PATH = os.path.join(DIR, 'alpha.db')
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
    # Migration: add username column if missing
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if 'username' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN username TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")
        conn.commit()
    if 'picture' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN picture TEXT")
        conn.commit()
    conn.close()


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
    row = conn.execute("SELECT google_id, email, name, username, picture FROM users WHERE google_id = ?", (google_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {'google_id': row['google_id'], 'email': row['email'], 'name': row['name'], 'username': row['username'], 'picture': row['picture']}


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
    """Delete a user and all their data (sessions, user_data)."""
    conn = _get_db()
    conn.execute("DELETE FROM user_data WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM sessions WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM users WHERE google_id = ?", (google_id,))
    conn.commit()
    conn.close()


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

def create_team(name, owner_google_id):
    conn = _get_db()
    cur = conn.execute(
        "INSERT INTO teams (name, owner_google_id) VALUES (?, ?)",
        (name, owner_google_id)
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
        SELECT t.id, t.name, tm.role,
               (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
        FROM teams t
        JOIN team_members tm ON tm.team_id = t.id AND tm.google_id = ?
        ORDER BY t.name
    """, (google_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'name': r['name'], 'role': r['role'], 'member_count': r['member_count']} for r in rows]


def get_team(team_id):
    conn = _get_db()
    team = conn.execute("SELECT id, name, owner_google_id, created FROM teams WHERE id = ?", (team_id,)).fetchone()
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


# Initialize DB on import
init_db()
