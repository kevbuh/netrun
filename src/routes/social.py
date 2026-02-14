"""Social routes — most ported to TypeScript IPC handlers.
Only profile picture/background upload and blog unpublish remain."""
import base64
import hashlib
import os
import time

from flask import Blueprint, request, jsonify

from helpers import require_auth
from db import DIR
from users import (
    get_user_info, get_public_user_info,
    update_user_picture, update_user_profile_bg,
)
from vault_helpers import (
    _read_vault_md, _get_user_vault_path, _write_vault_md,
)

bp = Blueprint('social', __name__)

UPLOADS_DIR = os.path.join(DIR, 'uploads')


@bp.route('/api/users/me/picture', methods=['PUT'])
@require_auth
def upload_profile_picture(google_id):
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
    fname = hashlib.sha256(google_id.encode()).hexdigest()[:16] + '_pic.' + ext
    fpath = os.path.join(UPLOADS_DIR, fname)
    with open(fpath, 'wb') as f:
        f.write(base64.b64decode(b64))
    picture_url = '/uploads/' + fname
    update_user_picture(google_id, picture_url)
    return jsonify({'ok': True, 'picture': picture_url})


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
