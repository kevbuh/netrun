"""Auth routes: Google login, logout, username, delete account, me, sync."""
import json
import os
import re
import ssl
import shutil
import urllib.request

from flask import Blueprint, request, jsonify

from helpers import require_auth, get_user_from_request
from persistence import (
    upsert_google_user, get_user_info, create_session,
    get_session_user, delete_session, set_username, delete_user,
    get_all_user_data, set_user_data_bulk, VAULT_DIR,
)
from vault_helpers import _get_user_vault_path

bp = Blueprint('auth', __name__)

GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com'


@bp.route('/api/auth/google', methods=['POST'])
def google_login():
    body = request.get_json(force=True, silent=True) or {}
    credential = body.get('credential', '')
    if not credential:
        return jsonify({'error': 'Missing credential'}), 400
    try:
        verify_url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + credential
        req = urllib.request.Request(verify_url)
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            token_info = json.loads(resp.read())
        if token_info.get('aud') != GOOGLE_CLIENT_ID:
            return jsonify({'error': 'Invalid token audience'}), 401
        import base64
        parts = credential.split('.')
        payload_b64 = parts[1] + '=' * (4 - len(parts[1]) % 4)
        jwt_payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        google_id = token_info.get('sub')
        email = token_info.get('email', '')
        name = token_info.get('name', '') or jwt_payload.get('name', '')
        picture = token_info.get('picture', '') or jwt_payload.get('picture', '')
        if not google_id:
            return jsonify({'error': 'Invalid token'}), 401
    except Exception as e:
        return jsonify({'error': f'Token verification failed: {e}'}), 401
    upsert_google_user(google_id, email, name, picture)
    token = create_session(google_id)
    info = get_user_info(google_id)
    username = info['username'] if info else None
    return jsonify({'token': token, 'email': email, 'name': name, 'username': username, 'picture': picture})


@bp.route('/api/auth/logout', methods=['POST'])
def logout():
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        delete_session(auth[7:])
    return jsonify({'ok': True})


@bp.route('/api/auth/username', methods=['POST'])
@require_auth
def set_username_route(google_id):
    body = request.get_json(force=True, silent=True) or {}
    username = (body.get('username') or '').strip()
    if not username or len(username) < 2 or len(username) > 20:
        return jsonify({'error': 'Username must be 2-20 characters'}), 400
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return jsonify({'error': 'Only letters, numbers, hyphens, and underscores'}), 400
    if set_username(google_id, username):
        return jsonify({'ok': True, 'username': username})
    else:
        return jsonify({'error': 'Username already taken'}), 409


@bp.route('/api/auth/delete-account', methods=['POST'])
@require_auth
def delete_account(google_id):
    # Get vault path before deleting user data
    vault_path = _get_user_vault_path(google_id)
    delete_user(google_id)
    # Optionally clean vault directory (user's files are in their vault)
    # We keep the vault files — user may want them even after deleting account
    return jsonify({'ok': True})


@bp.route('/api/auth/me')
def me():
    google_id = get_user_from_request()
    if google_id:
        info = get_user_info(google_id)
        if info:
            return jsonify(info)
        else:
            return jsonify({'google_id': google_id})
    else:
        return jsonify({'error': 'Not authenticated'}), 401


@bp.route('/api/sync', methods=['POST'])
@require_auth
def sync(google_id):
    body = request.get_json(force=True, silent=True) or {}
    client_data = body.get('data', {})
    server_data = get_all_user_data(google_id)
    to_save = {}
    merged = {}
    for key in set(list(client_data.keys()) + list(server_data.keys())):
        c = client_data.get(key)
        s = server_data.get(key)
        if c and s:
            if c.get('updated', 0) >= s.get('updated', 0):
                to_save[key] = c
                merged[key] = c
            else:
                merged[key] = s
        elif c:
            to_save[key] = c
            merged[key] = c
        else:
            merged[key] = s
    if to_save:
        set_user_data_bulk(google_id, to_save)
    return jsonify({'data': merged})
