"""Social routes: teams, users, messages, comments, reposts, achievements, blog, inbox."""
import base64
import hashlib
import json
import os
import re
import time

from flask import Blueprint, request, jsonify
from urllib.parse import unquote as url_unquote

from helpers import require_auth, optional_auth, get_user_from_request
from persistence import (
    EXPERIMENTS_DIR, DIR, read_meta,
    get_user_info, get_public_user_info, get_user_public_stats, get_user_recent_comments,
    create_repost, delete_repost, get_user_reposts, get_user_feed_sources,
    set_blog_vote, get_blog_votes,
    ACHIEVEMENTS, get_user_achievements, grant_achievement, has_achievement,
    get_user_shared_experiments, get_user_public_teams, search_users, list_users,
    create_team, get_user_teams, get_team, delete_team,
    invite_to_team, get_pending_invites, respond_to_invite,
    remove_team_member, rename_team,
    get_user_experiment_ids, get_team_experiments,
    get_user_accent_color, set_profile_private, are_teammates,
    update_user_picture, update_user_profile_bg,
    touch_last_seen, update_user_status,
    set_team_private, set_team_parent, get_team_children, get_team_ancestors,
    send_direct_message, get_direct_messages, mark_message_read,
    delete_direct_message, get_unread_message_count, get_user_by_username,
    send_team_message, get_team_messages, update_team_message, delete_team_message,
    toggle_reaction,
    mark_team_chat_read, get_unread_team_chats, get_unread_team_chat_count,
    get_team_todos, create_team_todo, update_team_todo, delete_team_todo,
    get_my_assigned_todos,
    db_get_comments, db_create_comment, db_delete_comment,
    _get_db,
)
from vault_helpers import (
    _read_vault_md, _get_user_vault_path, _find_vault_note_by_id, _write_vault_md,
    _sanitize_vault_filename,
)

bp = Blueprint('social', __name__)

UPLOADS_DIR = os.path.join(DIR, 'uploads')


# ── Helper: verify team membership ──

def _verify_team_member(team_id, google_id):
    """Check if google_id is a member of team_id. Returns True/False."""
    conn = _get_db()
    member = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
        (team_id, google_id)
    ).fetchone()
    conn.close()
    return member is not None


# ═══════════════════════════════════════════════════════════════════════════════
# GET routes
# ═══════════════════════════════════════════════════════════════════════════════


# 1. GET /api/teams — list user teams
@bp.route('/api/teams')
@require_auth
def list_teams(google_id):
    return jsonify(get_user_teams(google_id))


# 2. GET /api/teams/<team_id> — get team details with children and ancestors
@bp.route('/api/teams/<int:team_id>')
@require_auth
def get_team_detail(team_id, google_id):
    team = get_team(team_id)
    if not team:
        return jsonify({'error': 'Not found'}), 404
    team['children'] = get_team_children(team['id'])
    team['ancestors'] = get_team_ancestors(team['id'])
    return jsonify(team)


# 3. GET /api/inbox — get pending invites
@bp.route('/api/inbox')
@require_auth
def get_inbox(google_id):
    return jsonify(get_pending_invites(google_id))


# 4. GET /api/team-experiments — list experiments shared via teams
@bp.route('/api/team-experiments')
@require_auth
def list_team_experiments(google_id):
    teams = get_user_teams(google_id)
    result = []
    seen = set()
    for team in teams:
        exp_ids = get_team_experiments(team['id'])
        for eid in exp_ids:
            if eid in seen:
                continue
            seen.add(eid)
            meta = read_meta(eid)
            if meta:
                meta['id'] = eid
                meta['team_id'] = team['id']
                meta['team_name'] = team['name']
                runs = meta.get('runs', [])
                meta['runCount'] = len(runs)
                ts = [r.get('created', 0) for r in runs] + [meta.get('created', 0) or 0]
                exp_dir = os.path.join(EXPERIMENTS_DIR, eid)
                for root, dirs, files in os.walk(exp_dir):
                    for fname in files:
                        try:
                            ts.append(os.path.getmtime(os.path.join(root, fname)))
                        except OSError:
                            pass
                meta['lastUpdated'] = max(ts) if ts else 0
                result.append(meta)
    result.sort(key=lambda e: e.get('lastUpdated', 0), reverse=True)
    return jsonify(result)


# 5. GET /api/messages — get direct messages
@bp.route('/api/messages')
@require_auth
def get_messages(google_id):
    return jsonify(get_direct_messages(google_id))


# 6. GET /api/messages/unread-count — unread count across invites, messages, chats, tasks
@bp.route('/api/messages/unread-count')
@require_auth
def unread_count(google_id):
    invites = len(get_pending_invites(google_id))
    messages = get_unread_message_count(google_id)
    chats = get_unread_team_chat_count(google_id)
    tasks = len(get_my_assigned_todos(google_id))
    return jsonify({
        'invites': invites,
        'messages': messages,
        'chats': chats,
        'tasks': tasks,
        'total': invites + messages + chats + tasks,
    })


# 7. GET /api/teams/<team_id>/messages — team chat messages
@bp.route('/api/teams/<int:team_id>/messages')
@require_auth
def get_team_chat_messages(team_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    return jsonify(get_team_messages(team_id))


# 8. GET /api/teams/<team_id>/todos — team todos
@bp.route('/api/teams/<int:team_id>/todos')
@require_auth
def get_team_todos_route(team_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    return jsonify(get_team_todos(team_id))


# 9. GET /api/my-tasks — get assigned todos
@bp.route('/api/my-tasks')
@require_auth
def my_tasks(google_id):
    return jsonify(get_my_assigned_todos(google_id))


# 10. GET /api/inbox-chats — get unread team chats
@bp.route('/api/inbox-chats')
@require_auth
def inbox_chats(google_id):
    return jsonify(get_unread_team_chats(google_id))


# 11. GET /api/users or /api/users?q= — search/list users
@bp.route('/api/users')
@require_auth
def list_or_search_users(google_id):
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify(list_users())
    return jsonify(search_users(q))


# 12. GET /api/users/<username> — user profile
@bp.route('/api/users/<username>')
@require_auth
def get_user_profile(username, google_id):
    username = url_unquote(username)
    info = get_public_user_info(username)
    if not info:
        return jsonify({'error': 'User not found'}), 404
    # If profile is private and viewer is not a teammate, return limited info
    if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
        return jsonify({'username': info['username'], 'picture': info['picture'], 'profile_private': True})
    stats = get_user_public_stats(info['google_id'])
    info.update(stats)
    info['accent_color'] = get_user_accent_color(info['google_id'])
    del info['google_id']
    return jsonify(info)


# 13. GET /api/users/<username>/feeds — user's feed sources
@bp.route('/api/users/<username>/feeds')
@require_auth
def get_user_feeds(username, google_id):
    username = url_unquote(username)
    info = get_public_user_info(username)
    if not info:
        return jsonify({'error': 'User not found'}), 404
    if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
        return jsonify({'catalogFeeds': [], 'customFeeds': []})
    data = get_user_feed_sources(info['google_id'])
    catalog_keys = [k for k, v in data.get('feedSources', {}).items() if v]
    custom = [f for f in data.get('customFeeds', []) if f.get('enabled')]
    custom_out = [{'name': f.get('name', f.get('url', '')), 'url': f.get('url', '')} for f in custom]
    return jsonify({'catalogFeeds': catalog_keys, 'customFeeds': custom_out})


# 14. GET /api/users/<username>/comments — user's comments
@bp.route('/api/users/<username>/comments')
@require_auth
def get_user_comments(username, google_id):
    username = url_unquote(username)
    info = get_public_user_info(username)
    if not info:
        return jsonify({'error': 'User not found'}), 404
    if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
        return jsonify([])
    return jsonify(get_user_recent_comments(info['google_id']))


# 15. GET /api/users/<username>/reposts — user's reposts
@bp.route('/api/users/<username>/reposts')
@require_auth
def get_user_reposts_route(username, google_id):
    username = url_unquote(username)
    info = get_public_user_info(username)
    if not info:
        return jsonify({'error': 'User not found'}), 404
    if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
        return jsonify([])
    return jsonify(get_user_reposts(info['google_id']))


# 16. GET /api/users/<username>/teams — user's public teams
@bp.route('/api/users/<username>/teams')
@require_auth
def get_user_teams_route(username, google_id):
    username = url_unquote(username)
    info = get_public_user_info(username)
    if not info:
        return jsonify({'error': 'User not found'}), 404
    teams = get_user_public_teams(info['google_id'], viewer_google_id=google_id)
    return jsonify(teams)


# 17. GET /api/users/<username>/experiments — user's shared experiments
@bp.route('/api/users/<username>/experiments')
@require_auth
def get_user_experiments(username, google_id):
    username = url_unquote(username)
    info = get_public_user_info(username)
    if not info:
        return jsonify({'error': 'User not found'}), 404
    if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
        return jsonify([])
    exp_ids = get_user_shared_experiments(google_id, info['google_id'])
    result = []
    for eid in exp_ids:
        meta = read_meta(eid)
        if meta:
            meta['id'] = eid
            result.append(meta)
    return jsonify(result)


# 18. GET /api/achievements — current user achievements
@bp.route('/api/achievements')
@require_auth
def get_achievements(google_id):
    achievements = get_user_achievements(google_id)
    return jsonify({'achievements': achievements})


# 19. GET /api/achievements/<username> — specific user achievements
@bp.route('/api/achievements/<username>')
def get_user_achievements_route(username):
    user_info = get_public_user_info(username)
    if not user_info:
        return jsonify({'error': 'User not found'}), 404
    achievements = get_user_achievements(user_info['google_id'])
    return jsonify({'achievements': achievements})


# 20. GET /api/blog/<username> — list published blog posts (no auth required)
@bp.route('/api/blog/<username>')
def list_blog_posts(username):
    user_info = get_public_user_info(username)
    if not user_info:
        return jsonify({'error': 'User not found'}), 404
    blog_google_id = user_info['google_id']
    user_vault = _get_user_vault_path(blog_google_id)
    posts = []
    if os.path.isdir(user_vault):
        for fname in os.listdir(user_vault):
            if not fname.endswith('.md'):
                continue
            fpath = os.path.join(user_vault, fname)
            try:
                note = _read_vault_md(fpath)
                if note and note.get('published'):
                    posts.append({
                        'title': note.get('title', 'Untitled'),
                        'slug': note.get('slug'),
                        'published_at': note.get('published_at'),
                    })
            except Exception:
                pass
    posts.sort(key=lambda p: p.get('published_at', 0), reverse=True)
    return jsonify({'posts': posts, 'author': username, 'picture': user_info.get('picture')})


# 21. GET /api/blog/<username>/<slug> — get single blog post (optional_auth for votes)
@bp.route('/api/blog/<username>/<slug>')
@optional_auth
def get_blog_post(username, slug, google_id):
    user_info = get_public_user_info(username)
    if not user_info:
        return jsonify({'error': 'User not found'}), 404
    blog_google_id = user_info['google_id']
    user_vault = _get_user_vault_path(blog_google_id)
    if os.path.isdir(user_vault):
        for fname in os.listdir(user_vault):
            if not fname.endswith('.md'):
                continue
            fpath = os.path.join(user_vault, fname)
            try:
                note = _read_vault_md(fpath)
                if note and note.get('published') and note.get('slug') == slug:
                    votes = get_blog_votes(username, slug, google_id)
                    return jsonify({
                        'title': note.get('title', 'Untitled'),
                        'content': note.get('content', ''),
                        'author': username,
                        'published_at': note.get('published_at'),
                        'picture': user_info.get('picture'),
                        'upvotes': votes['upvotes'],
                        'downvotes': votes['downvotes'],
                        'userVote': votes['userVote'],
                    })
            except Exception:
                pass
    return jsonify({'error': 'Post not found'}), 404


# 22. GET /api/comments?paperLink= — get comments for a paper
@bp.route('/api/comments')
def get_comments():
    paper_link = request.args.get('paperLink', '').strip()
    return jsonify(db_get_comments(paper_link if paper_link else None))


# ═══════════════════════════════════════════════════════════════════════════════
# POST routes
# ═══════════════════════════════════════════════════════════════════════════════


# 23. POST /api/teams — create team
@bp.route('/api/teams', methods=['POST'])
@require_auth
def create_team_route(google_id):
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Team name required'}), 400
    private = bool(body.get('private', False))
    parent_id = body.get('parent_id')
    if parent_id is not None:
        parent_id = int(parent_id)
    team_id = create_team(name, google_id, private=private, parent_id=parent_id)
    return jsonify({'ok': True, 'id': team_id})


# 24. POST /api/teams/<team_id>/invite — invite user to team
@bp.route('/api/teams/<int:team_id>/invite', methods=['POST'])
@require_auth
def invite_to_team_route(team_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    username = (body.get('username') or '').strip()
    if not username:
        return jsonify({'error': 'Username required'}), 400
    result = invite_to_team(team_id, google_id, username)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


# 25. POST /api/teams/<team_id>/remove — remove team member
@bp.route('/api/teams/<int:team_id>/remove', methods=['POST'])
@require_auth
def remove_team_member_route(team_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    target = body.get('google_id', '')
    if not target:
        return jsonify({'error': 'google_id required'}), 400
    if remove_team_member(team_id, google_id, target):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not allowed'}), 403


# 26. POST /api/inbox/<invite_id>/respond — accept/decline invite
@bp.route('/api/inbox/<int:invite_id>/respond', methods=['POST'])
@require_auth
def respond_to_invite_route(invite_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    accept = body.get('accept', False)
    if respond_to_invite(invite_id, google_id, accept):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found or not yours'}), 404


# 27. POST /api/comments — create comment
@bp.route('/api/comments', methods=['POST'])
@require_auth
def create_comment(google_id):
    body = request.get_json(force=True, silent=True) or {}
    paper_link = body.get('paperLink', '').strip()
    content = body.get('content', '').strip()
    if not paper_link or not content:
        return jsonify({'error': 'paperLink and content required'}), 400
    comment = db_create_comment(google_id, body)
    return jsonify(comment), 201


# 28. POST /api/reposts — create repost
@bp.route('/api/reposts', methods=['POST'])
@require_auth
def create_repost_route(google_id):
    body = request.get_json(force=True, silent=True) or {}
    paper_link = body.get('paperLink', '').strip()
    paper_title = body.get('paperTitle', '').strip()
    username = body.get('username', '').strip()
    if not paper_link:
        return jsonify({'error': 'paperLink required'}), 400
    repost = create_repost(google_id, username, paper_link, paper_title)
    return jsonify(repost), 201


# 29. POST /api/messages — send direct message
@bp.route('/api/messages', methods=['POST'])
@require_auth
def send_message(google_id):
    body = request.get_json(force=True, silent=True) or {}
    to_username = (body.get('to_username') or '').strip()
    content = (body.get('content') or '').strip()
    if not to_username or not content:
        return jsonify({'error': 'to_username and content required'}), 400
    to_google_id = get_user_by_username(to_username)
    if not to_google_id:
        return jsonify({'error': 'User not found'}), 404
    if to_google_id == google_id:
        return jsonify({'error': 'Cannot message yourself'}), 400
    msg = send_direct_message(google_id, to_google_id, content)
    return jsonify(msg)


# 30. POST /api/messages/<msg_id>/read — mark message read
@bp.route('/api/messages/<msg_id>/read', methods=['POST'])
@require_auth
def mark_message_read_route(msg_id, google_id):
    mark_message_read(google_id, msg_id)
    return jsonify({'ok': True})


# 31. POST /api/teams/<team_id>/messages — send team message
@bp.route('/api/teams/<int:team_id>/messages', methods=['POST'])
@require_auth
def send_team_message_route(team_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    body = request.get_json(force=True, silent=True) or {}
    content = (body.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'content required'}), 400
    msg = send_team_message(team_id, google_id, content)
    return jsonify(msg)


# 32. POST /api/teams/<team_id>/chat-read — mark team chat read
@bp.route('/api/teams/<int:team_id>/chat-read', methods=['POST'])
@require_auth
def mark_team_chat_read_route(team_id, google_id):
    mark_team_chat_read(team_id, google_id)
    return jsonify({'ok': True})


# 33. POST /api/teams/<team_id>/messages/<msg_id>/reactions — toggle reaction
@bp.route('/api/teams/<int:team_id>/messages/<msg_id>/reactions', methods=['POST'])
@require_auth
def toggle_reaction_route(team_id, msg_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    body = request.get_json(force=True, silent=True) or {}
    emoji = (body.get('emoji') or '').strip()
    if not emoji:
        return jsonify({'error': 'emoji required'}), 400
    result = toggle_reaction(msg_id, google_id, emoji)
    return jsonify(result)


# 34. POST /api/teams/<team_id>/todos — create team todo
@bp.route('/api/teams/<int:team_id>/todos', methods=['POST'])
@require_auth
def create_team_todo_route(team_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    body = request.get_json(force=True, silent=True) or {}
    title = (body.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title required'}), 400
    todo = create_team_todo(team_id, google_id, body)
    return jsonify(todo)


# 35. POST /api/blog/<username>/<slug>/vote — vote on blog post
@bp.route('/api/blog/<username>/<slug>/vote', methods=['POST'])
@require_auth
def vote_blog_post(username, slug, google_id):
    body = request.get_json(force=True, silent=True) or {}
    vote = body.get('vote', 0)  # 1 = upvote, -1 = downvote, 0 = remove
    if vote not in (-1, 0, 1):
        return jsonify({'error': 'Invalid vote'}), 400
    result = set_blog_vote(username, slug, google_id, vote)
    return jsonify(result)


# 36. POST /api/blog/<username>/<slug>/unpublish — unpublish blog post
@bp.route('/api/blog/<username>/<slug>/unpublish', methods=['POST'])
@require_auth
def unpublish_blog_post(username, slug, google_id):
    user_info = get_user_info(google_id)
    if not user_info or user_info.get('username') != username:
        return jsonify({'error': 'Not authorized'}), 403
    user_vault = _get_user_vault_path(google_id)
    if os.path.isdir(user_vault):
        for fname in os.listdir(user_vault):
            if not fname.endswith('.md'):
                continue
            fpath = os.path.join(user_vault, fname)
            try:
                note = _read_vault_md(fpath)
                if note and note.get('published') and note.get('slug') == slug:
                    note['published'] = False
                    note['published_at'] = None
                    note['updated'] = int(time.time())
                    _write_vault_md(fpath, note)
                    return jsonify({'ok': True})
            except Exception:
                pass
    return jsonify({'error': 'Post not found'}), 404


# ═══════════════════════════════════════════════════════════════════════════════
# PUT routes
# ═══════════════════════════════════════════════════════════════════════════════


# 37. PUT /api/teams/<team_id> — rename team
@bp.route('/api/teams/<int:team_id>', methods=['PUT'])
@require_auth
def rename_team_route(team_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    new_name = body.get('name', '').strip()
    if not new_name:
        return jsonify({'error': 'Name required'}), 400
    if rename_team(team_id, new_name, google_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not team owner'}), 403


# 38. PUT /api/teams/<team_id>/messages/<msg_id> — edit team message
@bp.route('/api/teams/<int:team_id>/messages/<msg_id>', methods=['PUT'])
@require_auth
def edit_team_message(team_id, msg_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    content = (body.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'content required'}), 400
    if update_team_message(team_id, msg_id, google_id, content):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found or not yours'}), 404


# 39. PUT /api/teams/<team_id>/todos/<todo_id> — update team todo
@bp.route('/api/teams/<int:team_id>/todos/<todo_id>', methods=['PUT'])
@require_auth
def update_team_todo_route(team_id, todo_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    body = request.get_json(force=True, silent=True) or {}
    result = update_team_todo(team_id, todo_id, body)
    if result:
        return jsonify(result)
    return jsonify({'error': 'Not found'}), 404


# 40. PUT /api/teams/<team_id>/privacy — set team privacy
@bp.route('/api/teams/<int:team_id>/privacy', methods=['PUT'])
@require_auth
def set_team_privacy_route(team_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    private = bool(body.get('private', False))
    if set_team_private(team_id, private, google_id):
        return jsonify({'ok': True, 'private': private})
    return jsonify({'error': 'Not team owner'}), 403


# 41. PUT /api/teams/<team_id>/parent — set team parent
@bp.route('/api/teams/<int:team_id>/parent', methods=['PUT'])
@require_auth
def set_team_parent_route(team_id, google_id):
    body = request.get_json(force=True, silent=True) or {}
    parent_id = body.get('parent_id')
    if parent_id is not None:
        parent_id = int(parent_id)
    if set_team_parent(team_id, parent_id, google_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not allowed or circular reference'}), 403


# 42. PUT /api/users/me/picture — upload profile picture
@bp.route('/api/users/me/picture', methods=['PUT'])
@require_auth
def upload_profile_picture(google_id):
    body = request.get_json(force=True, silent=True) or {}
    image_data = body.get('image', '')
    if not image_data or not image_data.startswith('data:image/'):
        return jsonify({'error': 'Invalid image data'}), 400
    # Extract format and base64 content
    header, b64 = image_data.split(',', 1)
    ext = 'jpg'
    if 'png' in header:
        ext = 'png'
    elif 'webp' in header:
        ext = 'webp'
    fname = hashlib.sha256(google_id.encode()).hexdigest()[:16] + '_pic.' + ext
    fpath = os.path.join(UPLOADS_DIR, fname)
    with open(fpath, 'wb') as f:
        f.write(base64.b64decode(b64))
    picture_url = '/uploads/' + fname
    update_user_picture(google_id, picture_url)
    return jsonify({'ok': True, 'picture': picture_url})


# 43. PUT /api/users/me/background — upload profile background
@bp.route('/api/users/me/background', methods=['PUT'])
@require_auth
def upload_profile_background(google_id):
    body = request.get_json(force=True, silent=True) or {}
    image_data = body.get('image', '')
    if not image_data or not image_data.startswith('data:image/'):
        return jsonify({'error': 'Invalid image data'}), 400
    header, b64 = image_data.split(',', 1)
    ext = 'jpg'
    if 'png' in header:
        ext = 'png'
    elif 'webp' in header:
        ext = 'webp'
    fname = hashlib.sha256(google_id.encode()).hexdigest()[:16] + '_bg.' + ext
    fpath = os.path.join(UPLOADS_DIR, fname)
    with open(fpath, 'wb') as f:
        f.write(base64.b64decode(b64))
    bg_url = '/uploads/' + fname
    update_user_profile_bg(google_id, bg_url)
    return jsonify({'ok': True, 'profile_bg': bg_url})


# 44. PUT /api/users/me/privacy — set profile privacy
@bp.route('/api/users/me/privacy', methods=['PUT'])
@require_auth
def set_privacy(google_id):
    body = request.get_json(force=True, silent=True) or {}
    private = bool(body.get('profile_private', False))
    set_profile_private(google_id, private)
    return jsonify({'ok': True, 'profile_private': private})


# 45. PUT /api/users/me/status — set user status emoji/text
@bp.route('/api/users/me/status', methods=['PUT'])
@require_auth
def set_status(google_id):
    body = request.get_json(force=True, silent=True) or {}
    emoji = (body.get('emoji') or '').strip()
    text = (body.get('text') or '').strip()[:80]
    valid_emojis = ('cat', 'dog', 'bunny', 'froog', 'blackCat', 'poodle', 'pacman', '')
    if emoji and emoji not in valid_emojis:
        return jsonify({'error': 'Invalid emoji type'}), 400
    update_user_status(google_id, emoji, text)
    return jsonify({'ok': True, 'status_emoji': emoji or None, 'status_text': text or None})


# ═══════════════════════════════════════════════════════════════════════════════
# DELETE routes
# ═══════════════════════════════════════════════════════════════════════════════


# 46. DELETE /api/teams/<team_id> — delete team
@bp.route('/api/teams/<int:team_id>', methods=['DELETE'])
@require_auth
def delete_team_route(team_id, google_id):
    if delete_team(team_id, google_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not allowed or not found'}), 403


# 47. DELETE /api/reposts — delete repost
@bp.route('/api/reposts', methods=['DELETE'])
@require_auth
def delete_repost_route(google_id):
    body = request.get_json(force=True, silent=True) or {}
    paper_link = body.get('paperLink', '').strip()
    if not paper_link:
        return jsonify({'error': 'paperLink required'}), 400
    delete_repost(google_id, paper_link)
    return jsonify({'ok': True})


# 48. DELETE /api/comments/<comment_id> — delete comment
@bp.route('/api/comments/<comment_id>', methods=['DELETE'])
@require_auth
def delete_comment(comment_id, google_id):
    if db_delete_comment(google_id, comment_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found or not authorized'}), 404


# 49. DELETE /api/teams/<team_id>/messages/<msg_id> — delete team message
@bp.route('/api/teams/<int:team_id>/messages/<msg_id>', methods=['DELETE'])
@require_auth
def delete_team_message_route(team_id, msg_id, google_id):
    if delete_team_message(team_id, msg_id, google_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found or not yours'}), 404


# 50. DELETE /api/teams/<team_id>/todos/<todo_id> — delete team todo
@bp.route('/api/teams/<int:team_id>/todos/<todo_id>', methods=['DELETE'])
@require_auth
def delete_team_todo_route(team_id, todo_id, google_id):
    if not _verify_team_member(team_id, google_id):
        return jsonify({'error': 'Not a team member'}), 403
    if delete_team_todo(team_id, todo_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found'}), 404


# 51. DELETE /api/messages/<msg_id> — delete direct message
@bp.route('/api/messages/<msg_id>', methods=['DELETE'])
@require_auth
def delete_message(msg_id, google_id):
    if delete_direct_message(google_id, msg_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found'}), 404
