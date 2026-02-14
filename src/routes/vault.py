"""Vault routes — notes CRUD and vault-chat ported to TypeScript IPC.
Remaining: vault path, tree, and marimo start/stop."""
import json
import os
import subprocess
import time

from flask import Blueprint, request, jsonify

from helpers import require_auth
from db import VAULT_DIR
from users import get_user_data
from vault_helpers import (
    _read_vault_md, _write_vault_md,
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


@bp.route('/api/vault/tree')
@require_auth
def vault_tree(google_id):
    """Return full recursive file tree of the user's vault."""
    user_vault = _get_user_vault_path(google_id)
    skip_dirs = {'venv', '.kernels', '__pycache__', 'node_modules', '.git'}
    skip_files = {'.DS_Store', 'Thumbs.db', 'meta.json'}

    def walk_dir(dirpath, rel=''):
        items = []
        try:
            entries = sorted(os.listdir(dirpath))
        except OSError:
            return items
        for name in entries:
            if name.startswith('.'):
                continue
            full = os.path.join(dirpath, name)
            rel_path = os.path.join(rel, name) if rel else name
            if os.path.isdir(full):
                if name in skip_dirs:
                    continue
                children = walk_dir(full, rel_path)
                items.append({'name': name, 'path': rel_path, 'type': 'dir', 'children': children})
            elif os.path.isfile(full):
                if name in skip_files:
                    continue
                try:
                    mtime = os.path.getmtime(full)
                except OSError:
                    mtime = 0
                items.append({'name': name, 'path': rel_path, 'type': 'file', 'mtime': mtime})
        return items

    tree = walk_dir(user_vault)
    return jsonify(tree)


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
        with open(info['py_path'], encoding='utf-8') as f:
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
