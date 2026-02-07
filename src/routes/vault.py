"""Vault routes: notes CRUD, marimo start/stop, vault path."""
import os
import subprocess
import time
import uuid

from flask import Blueprint, request, jsonify

from helpers import require_auth
from persistence import VAULT_DIR, get_user_data
from vault_helpers import (
    _read_vault_md, _write_vault_md, _sanitize_vault_filename,
    _find_vault_note_by_id, _get_user_vault_path, _set_user_vault_path,
    _find_free_port,
)

bp = Blueprint('vault', __name__)

# Marimo notebook server management
_marimo_servers = {}  # {note_id: {proc, port, py_path}}


@bp.route('/api/vault/path')
@require_auth
def get_vault_path(google_id):
    custom_path = get_user_data(google_id, 'vaultPath')
    default_path = os.path.join(VAULT_DIR, google_id)
    return jsonify({
        'path': custom_path or default_path,
        'isCustom': bool(custom_path),
        'default': default_path
    })


@bp.route('/api/vault/path', methods=['POST'])
@require_auth
def set_vault_path(google_id):
    body = request.get_json(force=True, silent=True) or {}
    path = body.get('path', '').strip()
    success, message = _set_user_vault_path(google_id, path if path else None)
    if success:
        return jsonify({'ok': True, 'message': message, 'path': _get_user_vault_path(google_id)})
    else:
        return jsonify({'error': message}), 400


@bp.route('/api/vault/notes')
@require_auth
def list_notes(google_id):
    user_vault = _get_user_vault_path(google_id)
    notes = []
    if os.path.isdir(user_vault):
        for fname in os.listdir(user_vault):
            if not fname.endswith('.md'):
                continue
            fpath = os.path.join(user_vault, fname)
            try:
                note = _read_vault_md(fpath)
                if note:
                    notes.append(note)
            except Exception:
                pass
    notes.sort(key=lambda n: n.get('updated', 0), reverse=True)
    return jsonify(notes)


@bp.route('/api/vault/notes/<note_id>')
@require_auth
def get_note(google_id, note_id):
    user_vault = _get_user_vault_path(google_id)
    note_path, note = _find_vault_note_by_id(user_vault, note_id)
    if note:
        return jsonify(note)
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/vault/notes', methods=['POST'])
@require_auth
def create_note(google_id):
    body = request.get_json(force=True, silent=True) or {}
    note_id = str(uuid.uuid4())[:8]
    title = body.get('title', 'Untitled')
    note = {
        'id': note_id,
        'title': title,
        'content': body.get('content', ''),
        'folder': body.get('folder'),
        'created': int(time.time()),
        'updated': int(time.time())
    }
    if body.get('forked_from'):
        note['forked_from'] = body['forked_from']
    if body.get('type'):
        note['type'] = body['type']
    user_vault = _get_user_vault_path(google_id)
    base_fname = _sanitize_vault_filename(title)
    fname = f'{base_fname}.md'
    fpath = os.path.join(user_vault, fname)
    counter = 1
    while os.path.exists(fpath):
        fname = f'{base_fname} {counter}.md'
        fpath = os.path.join(user_vault, fname)
        counter += 1
    _write_vault_md(fpath, note)
    return jsonify(note), 201


@bp.route('/api/vault/notes/<note_id>', methods=['PUT'])
@require_auth
def update_note(google_id, note_id):
    from persistence import slugify, grant_achievement
    user_vault = _get_user_vault_path(google_id)
    note_path, note = _find_vault_note_by_id(user_vault, note_id)
    if not note:
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    old_title = note.get('title', 'Untitled')
    new_title = body.get('title', old_title)
    note['title'] = new_title
    note['content'] = body.get('content', note.get('content', ''))
    if 'folder' in body:
        note['folder'] = body['folder']
    new_achievement = None
    if 'published' in body:
        was_published = note.get('published', False)
        note['published'] = body['published']
        if body['published']:
            note['slug'] = slugify(note['title']) or note_id
            note['published_at'] = note.get('published_at') or int(time.time())
            if not was_published:
                new_achievement = grant_achievement(google_id, 'first_blog')
        else:
            note['published_at'] = None
    note['updated'] = int(time.time())
    base_fname = _sanitize_vault_filename(new_title)
    new_fname = f'{base_fname}.md'
    new_path = os.path.join(user_vault, new_fname)
    if new_path != note_path and os.path.exists(new_path):
        counter = 1
        while os.path.exists(new_path):
            new_fname = f'{base_fname} {counter}.md'
            new_path = os.path.join(user_vault, new_fname)
            counter += 1
    if note_path and note_path != new_path and os.path.exists(note_path):
        os.remove(note_path)
    _write_vault_md(new_path, note)
    response = dict(note)
    if new_achievement:
        response['achievement'] = new_achievement
    return jsonify(response)


@bp.route('/api/vault/notes/<note_id>', methods=['DELETE'])
@require_auth
def delete_note(google_id, note_id):
    user_vault = _get_user_vault_path(google_id)
    note_path, note = _find_vault_note_by_id(user_vault, note_id)
    if note_path and os.path.exists(note_path):
        os.remove(note_path)
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/vault/marimo/start', methods=['POST'])
@require_auth
def marimo_start(google_id):
    body = request.get_json(force=True, silent=True) or {}
    note_id = body.get('note_id')
    if not note_id:
        return jsonify({'error': 'note_id required'}), 400
    if note_id in _marimo_servers:
        return jsonify({'port': _marimo_servers[note_id]['port']})
    user_vault = _get_user_vault_path(google_id)
    note_path, note = _find_vault_note_by_id(user_vault, note_id)
    if not note or note.get('type') != 'marimo':
        return jsonify({'error': 'Marimo note not found'}), 404
    py_path = os.path.join(user_vault, f'.marimo_{note_id}.py')
    with open(py_path, 'w', encoding='utf-8') as f:
        f.write(note.get('content', ''))
    port = _find_free_port()
    try:
        proc = subprocess.Popen(
            ['marimo', 'edit', py_path, '--headless', '--no-token', '-p', str(port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        _marimo_servers[note_id] = {'proc': proc, 'port': port, 'py_path': py_path, 'note_path': note_path}
        return jsonify({'port': port})
    except FileNotFoundError:
        os.remove(py_path)
        return jsonify({'error': 'marimo is not installed. Run: pip install marimo'}), 500


@bp.route('/api/vault/marimo/stop', methods=['POST'])
@require_auth
def marimo_stop(google_id):
    body = request.get_json(force=True, silent=True) or {}
    note_id = body.get('note_id')
    if not note_id or note_id not in _marimo_servers:
        return jsonify({'error': 'No marimo server running for this note'}), 404
    info = _marimo_servers.pop(note_id)
    updated_content = ''
    try:
        with open(info['py_path'], 'r', encoding='utf-8') as f:
            updated_content = f.read()
    except Exception:
        pass
    try:
        info['proc'].terminate()
        info['proc'].wait(timeout=5)
    except Exception:
        try:
            info['proc'].kill()
        except Exception:
            pass
    try:
        os.remove(info['py_path'])
    except Exception:
        pass
    user_vault = _get_user_vault_path(google_id)
    note_path, note = _find_vault_note_by_id(user_vault, note_id)
    if note and note_path:
        note['content'] = updated_content
        note['updated'] = int(time.time())
        _write_vault_md(note_path, note)
    return jsonify({'ok': True, 'content': updated_content})
