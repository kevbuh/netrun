import os
import json
import re
import ssl
import time
import urllib.request
import sqlite3
import secrets

DIR = os.environ.get('ARXIV_DATA_DIR', os.path.dirname(os.path.abspath(__file__)))
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, timestamp)
_cache = {}

EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')

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
    """)
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


def get_user_public_teams(google_id):
    conn = _get_db()
    rows = conn.execute("""
        SELECT t.id, t.name,
               (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
        FROM teams t
        JOIN team_members tm ON tm.team_id = t.id AND tm.google_id = ?
        ORDER BY t.name
    """, (google_id,)).fetchall()
    conn.close()
    return [{'id': r['id'], 'name': r['name'], 'member_count': r['member_count']} for r in rows]


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

def get_public_user_info(username):
    """Case-insensitive lookup. Returns {username, picture, created} or None."""
    conn = _get_db()
    row = conn.execute(
        "SELECT google_id, username, picture, created FROM users WHERE lower(username) = ?",
        (username.lower(),)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {
        'google_id': row['google_id'],
        'username': row['username'],
        'picture': row['picture'],
        'created': row['created']
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
    conn.close()
    return {
        'comment_count': comment_count,
        'team_count': team_count,
        'experiment_count': experiment_count
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
    """Search users by username prefix. Returns list of {username, picture}."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT username, picture FROM users WHERE username IS NOT NULL AND username LIKE ? LIMIT ?",
        (query + '%', limit)
    ).fetchall()
    conn.close()
    return [{'username': r['username'], 'picture': r['picture']} for r in rows]


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


# Initialize DB on import
init_db()
