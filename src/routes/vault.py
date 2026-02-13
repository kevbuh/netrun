"""Vault routes: notes CRUD, file tree, marimo start/stop, vault path, migration."""
import json
import os
import shutil
import subprocess
import time
import urllib.request
import uuid

from flask import Blueprint, request, jsonify, Response, stream_with_context

from helpers import require_auth, sse_event
from db import VAULT_DIR
from users import get_user_data
from embeddings import embed_text_ollama, search_embeddings
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
    from utils_persistence import slugify
    from users import grant_achievement
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


@bp.route('/api/vault-chat', methods=['POST'])
@require_auth
def vault_chat(google_id):
    """RAG chat over vault notes: embed query, retrieve relevant notes, stream LLM response."""
    body = request.get_json(force=True, silent=True) or {}
    messages = body.get('messages', [])
    query = body.get('query', '')
    min_similarity = body.get('min_similarity', 0.7)
    if not messages:
        return jsonify({'error': 'messages required'}), 400

    # Embed the query and search note embeddings
    query_vec = embed_text_ollama(query) if query else None
    sources = []
    context_chunks = []
    if query_vec:
        results = search_embeddings(query_vec, content_type='note', limit=5)
        user_vault = _get_user_vault_path(google_id)
        for r in results:
            if r['score'] < min_similarity:
                continue
            link = r.get('link', '')
            if not link.startswith('vault://'):
                continue
            note_id = link[len('vault://'):]
            _, note = _find_vault_note_by_id(user_vault, note_id)
            if not note:
                continue
            content = (note.get('content', '') or '')[:4096]
            sources.append({'id': note_id, 'title': note.get('title', 'Untitled'), 'score': r['score']})
            context_chunks.append(f"--- Note: {note.get('title', 'Untitled')} ---\n{content}")

    # Build system prompt with retrieved notes
    if context_chunks:
        numbered_chunks = [f"[{i+1}] {chunk}" for i, chunk in enumerate(context_chunks)]
        notes_text = '\n\n'.join(numbered_chunks)
        system_msg = (
            "You are a helpful assistant with access to the user's personal notes. "
            "Answer their questions based on the note contents below when relevant. "
            "Cite sources inline using [1], [2], etc. to reference the note numbers.\n\n"
            "--- NOTES ---\n" + notes_text + "\n--- END NOTES ---"
        )
    else:
        system_msg = (
            "You are a helpful assistant. The user is asking about their notes, "
            "but no relevant notes were found. Let them know and answer as best you can."
        )

    ollama_messages = [{"role": "system", "content": system_msg}] + messages

    def generate():
        try:
            yield sse_event('sources', sources)

            payload = json.dumps({
                "model": "qwen2.5:3b",
                "messages": ollama_messages,
                "stream": True
            }).encode()
            req = urllib.request.Request(
                "http://localhost:11434/api/chat",
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                for line in resp:
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield sse_event('token', token)
                    if chunk.get("done"):
                        break
            yield sse_event('done', {})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            yield sse_event('error', str(e))

    return Response(stream_with_context(generate()),
                    content_type='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive'})


