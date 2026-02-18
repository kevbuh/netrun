"""User management - auth, sessions, user data, calendar, social features."""

import json
import time
import secrets
import uuid
import sqlite3

from db import _get_db


# ── User CRUD ──

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
    """Delete a user and all their data."""
    conn = _get_db()
    conn.execute("DELETE FROM calendar_events WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM comments WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM user_data WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM sessions WHERE google_id = ?", (google_id,))
    conn.execute("DELETE FROM users WHERE google_id = ?", (google_id,))
    conn.commit()
    conn.close()


# ── Sessions ──

def create_session(google_id):
    from db import SESSION_TTL
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


# ── User data (key-value store) ──

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
    """Returns {comment_count, repost_count}."""
    conn = _get_db()
    comment_count = conn.execute(
        "SELECT COUNT(*) as c FROM comments WHERE google_id = ?", (google_id,)
    ).fetchone()['c']
    repost_count = conn.execute(
        "SELECT COUNT(*) as c FROM reposts WHERE google_id = ?", (google_id,)
    ).fetchone()['c']
    conn.close()
    return {
        'comment_count': comment_count,
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


# ── Reposts ──

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


# ── Achievements ──

# Achievement definitions
ACHIEVEMENTS = {
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


# ── Profile Privacy ──

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


# ── Usage history ──

def get_usage_history(days=30):
    from collections import defaultdict
    conn = _get_db()
    since = time.time() - days * 86400
    rows = conn.execute(
        "SELECT event, ts FROM usage_log WHERE ts > ? ORDER BY ts", (since,)
    ).fetchall()
    conn.close()
    by_day = defaultdict(lambda: defaultdict(int))
    for r in rows:
        day = time.strftime('%Y-%m-%d', time.localtime(r['ts']))
        by_day[day][r['event']] += 1
    return dict(by_day)
