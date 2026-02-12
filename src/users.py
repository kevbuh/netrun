"""User management - auth, sessions, user data, calendar, teams, social features."""

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
