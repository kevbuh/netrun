"""Experiment routes: CRUD for experiments, files, runs, venvs, packages, kernels, folders, uploads."""
import os
import json
import re
import uuid
import time
import base64
import shutil
import subprocess
import threading
import tempfile
from urllib.parse import unquote as url_unquote

from flask import Blueprint, request, jsonify, Response, stream_with_context

from helpers import require_auth, require_experiment_access, get_user_from_request, sse_event
from persistence import (
    EXPERIMENTS_DIR, read_meta, write_meta, slugify, unique_slug,
    set_experiment_owner, get_user_experiment_ids, user_can_access_experiment,
    get_user_teams, get_team_experiments, set_experiment_team, remove_experiment_team,
)
from kernels import (
    _get_kernel, _kill_kernel, _get_python_path,
    _validate_package_names, _create_venv,
    _execute_code, _execute_code_streaming,
    _kernels, _kernels_lock,
)

bp = Blueprint('experiments', __name__)


# ---------------------------------------------------------------------------
# GET routes
# ---------------------------------------------------------------------------

@bp.route('/api/experiments', methods=['GET'])
@require_auth
def list_experiments(google_id):
    """List all experiments the user has access to."""
    allowed_ids = get_user_experiment_ids(google_id)
    # Build lookup of experiment -> team info
    user_teams = get_user_teams(google_id)
    exp_team_map = {}
    for t in user_teams:
        for eid in get_team_experiments(t['id']):
            if eid not in exp_team_map:
                exp_team_map[eid] = {'team_id': t['id'], 'team_name': t['name']}
    experiments = []
    if os.path.isdir(EXPERIMENTS_DIR):
        for name in sorted(os.listdir(EXPERIMENTS_DIR)):
            if name == '_unstructured':
                continue
            if name not in allowed_ids:
                continue
            meta = read_meta(name)
            if meta:
                meta['id'] = name
                runs = meta.get('runs', [])
                meta['runCount'] = len(runs)
                ts = [r.get('created', 0) for r in runs] + [meta.get('created', 0) or 0]
                # Include file modification times for accurate lastUpdated
                exp_dir = os.path.join(EXPERIMENTS_DIR, name)
                for root, dirs, files in os.walk(exp_dir):
                    for fname in files:
                        try:
                            ts.append(os.path.getmtime(os.path.join(root, fname)))
                        except OSError:
                            pass
                meta['lastUpdated'] = max(ts) if ts else 0
                if name in exp_team_map:
                    meta['team_id'] = exp_team_map[name]['team_id']
                    meta['team_name'] = exp_team_map[name]['team_name']
                experiments.append(meta)
    experiments.sort(key=lambda e: e.get('lastUpdated', 0), reverse=True)
    return jsonify(experiments)


@bp.route('/api/experiments/<exp_id>', methods=['GET'])
@require_experiment_access
def get_experiment(exp_id, google_id):
    """Get a single experiment's metadata."""
    meta = read_meta(exp_id)
    if meta:
        meta['id'] = exp_id
        return jsonify(meta)
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/experiments/<exp_id>/files', methods=['GET'])
@require_experiment_access
def list_files(exp_id, google_id):
    """List all files in an experiment directory."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    skip_dirs = {'venv', '.kernels', '__pycache__', 'node_modules', '.git'}
    skip_files = {'meta.json', '.DS_Store', 'Thumbs.db'}
    files = []
    dirs_with_files = set()
    all_dirs = set()
    for dirpath, dirnames, filenames in os.walk(exp_dir):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        rel_dir = os.path.relpath(dirpath, exp_dir)
        if rel_dir != '.':
            # Track top-level folder name
            top = rel_dir.split(os.sep)[0]
            all_dirs.add(top)
        for f in filenames:
            if f not in skip_files and not f.startswith('.'):
                rel = os.path.relpath(os.path.join(dirpath, f), exp_dir)
                files.append(rel)
                if '/' in rel or os.sep in rel:
                    dirs_with_files.add(rel.split('/')[0].split(os.sep)[0])
    # Also check immediate subdirectories for empty folders
    for d in os.listdir(exp_dir):
        if d not in skip_dirs and os.path.isdir(os.path.join(exp_dir, d)):
            all_dirs.add(d)
    files.sort()
    empty_dirs = sorted(all_dirs - dirs_with_files)
    return jsonify({'files': files, 'emptyDirs': empty_dirs})


@bp.route('/api/experiments/<exp_id>/files/<path:fname>', methods=['GET'])
@require_experiment_access
def get_file(exp_id, google_id, fname):
    """Read a single file (text or binary base64)."""
    fname = url_unquote(fname)
    if '..' in fname:
        return jsonify({'error': 'Invalid path'}), 400
    fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
    if not os.path.isfile(fpath):
        return jsonify({'error': 'Not found'}), 404
    _binary_mime = {
        '.png': 'image/png', '.svg': 'image/svg+xml',
        '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.webm': 'video/webm',
        '.zip': 'application/zip', '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
    }
    ext = os.path.splitext(fname)[1].lower()
    if ext in _binary_mime:
        with open(fpath, 'rb') as f:
            data = base64.b64encode(f.read()).decode()
        mime = _binary_mime[ext]
        return jsonify({'name': fname, 'content': f'data:{mime};base64,{data}', 'binary': True, 'mime': mime})
    else:
        try:
            with open(fpath, 'r') as f:
                content = f.read()
            return jsonify({'name': fname, 'content': content})
        except UnicodeDecodeError:
            with open(fpath, 'rb') as f:
                data = base64.b64encode(f.read()).decode()
            return jsonify({'name': fname, 'content': f'data:application/octet-stream;base64,{data}', 'binary': True, 'mime': 'application/octet-stream'})


@bp.route('/api/experiments/<exp_id>/raw/<path:fname>', methods=['GET'])
@require_experiment_access
def get_raw_file(exp_id, google_id, fname):
    """Serve raw binary file (images, PDFs)."""
    fname = url_unquote(fname)
    if '..' in fname:
        return Response('Bad request', status=400)
    fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
    if not os.path.isfile(fpath):
        return Response('Not found', status=404)
    ext = os.path.splitext(fname)[1].lower()
    mime_map = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.pdf': 'application/pdf',
    }
    mime = mime_map.get(ext, 'application/octet-stream')
    with open(fpath, 'rb') as f:
        data = f.read()
    return Response(data, status=200, headers={
        'Content-Type': mime,
        'Content-Length': str(len(data)),
        'Cache-Control': 'no-cache',
    })


@bp.route('/api/experiments/<exp_id>/compile-tex/<path:fname>', methods=['GET'])
@require_experiment_access
def compile_tex(exp_id, google_id, fname):
    """Compile a LaTeX file and return the resulting PDF."""
    fname = url_unquote(fname)
    fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
    if not os.path.isfile(fpath) or not fname.endswith('.tex'):
        return jsonify({'error': 'Not found'}), 404
    tmp = tempfile.mkdtemp()
    try:
        tex_basename = os.path.basename(fname)
        shutil.copy(fpath, os.path.join(tmp, tex_basename))
        # Copy all support files (.sty, .bst, .bib, helper .tex) from the same directory as the .tex file
        tex_dir = os.path.dirname(fpath)
        for sf in os.listdir(tex_dir):
            if sf != tex_basename and (sf.endswith('.sty') or sf.endswith('.bst') or sf.endswith('.bib') or (sf.endswith('.tex') and sf != tex_basename)):
                src = os.path.join(tex_dir, sf)
                if os.path.isfile(src):
                    shutil.copy(src, tmp)
        # Fallback: copy legacy .sty if nothing was found
        if not any(f.endswith('.sty') for f in os.listdir(tmp)):
            sty_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'neurips_2023.sty')
            if not os.path.isfile(sty_path):
                sty_path = os.path.join(os.path.dirname(__file__), '..', 'neurips_2023.sty')
            if os.path.isfile(sty_path):
                shutil.copy(sty_path, tmp)
        # First pdflatex pass
        result = subprocess.run(
            ['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
            cwd=tmp, capture_output=True, text=True, timeout=30
        )
        # Run bibtex if .bib files present
        aux_name = tex_basename.rsplit('.', 1)[0]
        if any(f.endswith('.bib') for f in os.listdir(tmp)):
            subprocess.run(['bibtex', aux_name], cwd=tmp, capture_output=True, text=True, timeout=15)
            # Two more pdflatex passes to resolve references
            subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
                           cwd=tmp, capture_output=True, text=True, timeout=30)
            result = subprocess.run(
                ['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
                cwd=tmp, capture_output=True, text=True, timeout=30
            )
        pdf_path = os.path.join(tmp, aux_name + '.pdf')
        if result.returncode != 0 or not os.path.isfile(pdf_path):
            log = result.stdout + '\n' + result.stderr
            return jsonify({'error': 'Compilation failed', 'log': log}), 400
        with open(pdf_path, 'rb') as f:
            pdf_data = f.read()
        return Response(pdf_data, status=200, headers={
            'Content-Type': 'application/pdf',
            'Content-Length': str(len(pdf_data)),
            'Access-Control-Allow-Origin': '*',
        })
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@bp.route('/api/experiments/<exp_id>/packages', methods=['GET'])
@require_experiment_access
def list_packages(exp_id, google_id):
    """List pip packages for an experiment."""
    if not read_meta(exp_id):
        return jsonify({'error': 'Not found'}), 404
    python_path = _get_python_path(exp_id)
    try:
        result = subprocess.run(
            [python_path, '-m', 'pip', 'list', '--format=json'],
            capture_output=True, text=True, timeout=30
        )
        packages = json.loads(result.stdout) if result.returncode == 0 else []
        return jsonify(packages)
    except Exception:
        return jsonify([])


@bp.route('/api/experiments/<exp_id>/venv-info', methods=['GET'])
@require_experiment_access
def venv_info(exp_id, google_id):
    """Get venv details: pythonVersion, diskSize, packageCount."""
    meta = read_meta(exp_id)
    if not meta:
        return jsonify({'error': 'Not found'}), 404
    python_path = _get_python_path(exp_id)
    venv_dir = os.path.join(EXPERIMENTS_DIR, exp_id, 'venv')
    has_venv = os.path.isdir(venv_dir)
    info = {'hasVenv': has_venv, 'pythonPath': python_path}
    try:
        result = subprocess.run(
            [python_path, '--version'],
            capture_output=True, text=True, timeout=10
        )
        info['pythonVersion'] = result.stdout.strip() if result.returncode == 0 else 'Unknown'
    except Exception:
        info['pythonVersion'] = 'Unknown'
    if has_venv:
        info['venvPath'] = venv_dir
        try:
            total = sum(
                os.path.getsize(os.path.join(dp, f))
                for dp, _, fnames in os.walk(venv_dir)
                for f in fnames
            )
            if total < 1024 * 1024:
                info['diskSize'] = f'{total / 1024:.0f} KB'
            elif total < 1024 * 1024 * 1024:
                info['diskSize'] = f'{total / (1024*1024):.1f} MB'
            else:
                info['diskSize'] = f'{total / (1024*1024*1024):.2f} GB'
        except Exception:
            info['diskSize'] = 'Unknown'
        try:
            result = subprocess.run(
                [python_path, '-m', 'pip', 'list', '--format=json'],
                capture_output=True, text=True, timeout=15
            )
            pkgs = json.loads(result.stdout) if result.returncode == 0 else []
            info['packageCount'] = len(pkgs)
            info['packages'] = [p['name'] for p in pkgs[:20]]
        except Exception:
            info['packageCount'] = 0
            info['packages'] = []
    return jsonify(info)


@bp.route('/api/venvs', methods=['GET'])
@require_auth
def list_venvs(google_id):
    """List all experiments that have venvs."""
    venvs = []
    if os.path.isdir(EXPERIMENTS_DIR):
        for name in sorted(os.listdir(EXPERIMENTS_DIR)):
            venv_python = os.path.join(EXPERIMENTS_DIR, name, 'venv', 'bin', 'python')
            if os.path.exists(venv_python):
                meta = read_meta(name)
                title = (meta or {}).get('title', name)
                venvs.append({'id': name, 'title': title, 'pythonPath': venv_python})
    return jsonify(venvs)


# ---------------------------------------------------------------------------
# POST routes
# ---------------------------------------------------------------------------

@bp.route('/api/experiments', methods=['POST'])
@require_auth
def create_experiment(google_id):
    """Create a new experiment."""
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    desc = body.get('desc', '').strip()
    if not title:
        return jsonify({'error': 'Title required'}), 400
    slug = unique_slug(slugify(title))
    exp_dir = os.path.join(EXPERIMENTS_DIR, slug)
    os.makedirs(exp_dir, exist_ok=True)
    meta = {
        'title': title,
        'desc': desc,
        'created': body.get('created', None),
        'runs': []
    }
    write_meta(slug, meta)
    set_experiment_owner(slug, google_id)
    meta['id'] = slug
    return jsonify(meta), 201


@bp.route('/api/experiments/<exp_id>/runs', methods=['POST'])
@require_experiment_access
def add_run(exp_id, google_id):
    """Add a run to an experiment."""
    meta = read_meta(exp_id)
    if not meta:
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    name = body.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    run = {
        'id': str(uuid.uuid4()),
        'name': name,
        'status': body.get('status', 'running'),
        'notes': body.get('notes', ''),
        'results': body.get('results', ''),
        'created': body.get('created', int(time.time() * 1000)),
        'algorithm': body.get('algorithm', ''),
        'environment': body.get('environment', ''),
        'hyperparameters': body.get('hyperparameters', {}),
        'reward': body.get('reward', None),
        'episodes': body.get('episodes', None)
    }
    meta.setdefault('runs', []).append(run)
    write_meta(exp_id, meta)
    return jsonify(run), 201


@bp.route('/api/experiments/<exp_id>/files', methods=['POST'])
@require_experiment_access
def create_file(exp_id, google_id):
    """Create a new file in an experiment (various types: .md, .ipynb, .py, .tex, .draw, .slides, etc.)."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    name = body.get('name', '').strip()
    allowed_ext = ('.md', '.ipynb', '.py', '.tex', '.png', '.svg', '.mermaid', '.draw', '.slides')
    if not name or not any(name.endswith(e) for e in allowed_ext):
        return jsonify({'error': f'Name must end with {", ".join(allowed_ext)}'}), 400
    fpath = os.path.join(exp_dir, name)
    # For template-based .tex files, check the folder instead
    template_key = body.get('template') if name.endswith('.tex') else None
    if template_key:
        folder_dir = os.path.join(exp_dir, template_key)
        if os.path.exists(folder_dir):
            return jsonify({'error': 'Folder already exists'}), 409
    elif os.path.exists(fpath):
        return jsonify({'error': 'File already exists'}), 409
    initial = body.get('content', None)
    if name.endswith(('.png', '.svg')) and initial:
        # Strip data URI prefix if present
        if ',' in initial:
            initial = initial.split(',', 1)[1]
        with open(fpath, 'wb') as f:
            f.write(base64.b64decode(initial))
    elif initial is not None:
        with open(fpath, 'w') as f:
            f.write(initial)
    elif name.endswith('.ipynb'):
        with open(fpath, 'w') as f:
            f.write(json.dumps({
                "cells": [{"cell_type": "code", "source": "", "outputs": []}],
                "metadata": {},
                "nbformat": 4, "nbformat_minor": 5
            }, indent=2))
    elif name.endswith('.draw'):
        with open(fpath, 'w') as f:
            f.write(json.dumps({"version": 1, "objects": []}))
    elif name.endswith('.slides'):
        with open(fpath, 'w') as f:
            f.write(json.dumps({"version": 1, "slides": [{"id": "slide-1", "objects": [], "background": None}]}))
    elif name.endswith('.tex'):
        template_key = body.get('template')
        if template_key:
            # Create inside a folder named after the template
            templates_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates', template_key)
            template_tex = os.path.join(templates_dir, 'template.tex')
            if os.path.isfile(template_tex):
                folder_name = template_key
                folder_dir = os.path.join(EXPERIMENTS_DIR, exp_id, folder_name)
                os.makedirs(folder_dir, exist_ok=True)
                tex_name = 'paper.tex'
                fpath = os.path.join(folder_dir, tex_name)
                name = folder_name + '/' + tex_name
                shutil.copy(template_tex, fpath)
                # Copy support files into the same folder
                for sf in os.listdir(templates_dir):
                    if sf != 'template.tex':
                        dst = os.path.join(folder_dir, sf)
                        if not os.path.exists(dst):
                            shutil.copy(os.path.join(templates_dir, sf), dst)
            else:
                with open(fpath, 'w') as f:
                    f.write('')
        else:
            with open(fpath, 'w') as f:
                f.write('')
    else:
        with open(fpath, 'w') as f:
            f.write('')
    return jsonify({'name': name}), 201


@bp.route('/api/experiments/<exp_id>/upload', methods=['POST'])
@require_experiment_access
def upload_file(exp_id, google_id):
    """Multipart file upload to an experiment."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    content_type = request.headers.get('Content-Type', '')
    if 'multipart/form-data' not in content_type:
        return jsonify({'error': 'multipart/form-data required'}), 400
    # Parse boundary from Content-Type
    boundary = None
    for part in content_type.split(';'):
        part = part.strip()
        if part.startswith('boundary='):
            boundary = part[9:].strip('"')
    if not boundary:
        return jsonify({'error': 'Missing boundary'}), 400
    body_bytes = request.get_data()
    boundary_bytes = ('--' + boundary).encode()
    parts = body_bytes.split(boundary_bytes)
    uploaded = []
    for part in parts:
        if part in (b'', b'--', b'--\r\n', b'\r\n'):
            continue
        # Split headers from content
        header_end = part.find(b'\r\n\r\n')
        if header_end == -1:
            continue
        headers_raw = part[:header_end].decode('utf-8', errors='replace')
        file_data = part[header_end + 4:]
        # Strip trailing \r\n
        if file_data.endswith(b'\r\n'):
            file_data = file_data[:-2]
        # Extract filename from Content-Disposition
        fname = None
        for line in headers_raw.split('\r\n'):
            if 'filename="' in line:
                start = line.index('filename="') + 10
                end = line.index('"', start)
                fname = line[start:end]
        if not fname:
            continue
        fname = os.path.basename(fname)
        if not fname or '..' in fname:
            continue
        fpath = os.path.join(exp_dir, fname)
        file_base, ext = os.path.splitext(fname)
        i = 2
        while os.path.exists(fpath):
            fpath = os.path.join(exp_dir, f'{file_base}_{i}{ext}')
            i += 1
        with open(fpath, 'wb') as f:
            f.write(file_data)
        uploaded.append(os.path.basename(fpath))
    return jsonify({'uploaded': uploaded}), 201


@bp.route('/api/experiments/<exp_id>/execute', methods=['POST'])
@require_experiment_access
def execute_code(exp_id, google_id):
    """Execute code in an experiment's kernel (streaming SSE or synchronous)."""
    if not read_meta(exp_id):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    code = body.get('code', '')
    stream = body.get('stream', False)
    if stream:
        import queue

        def generate():
            q = queue.Queue()

            class FakeWfile:
                def write(self, data):
                    q.put(data)

                def flush(self):
                    pass

            fake = FakeWfile()
            connected = [True]

            def run():
                try:
                    _execute_code_streaming(exp_id, code, fake, lambda: connected[0])
                except Exception:
                    pass
                q.put(None)  # sentinel

            t = threading.Thread(target=run, daemon=True)
            t.start()
            while True:
                item = q.get()
                if item is None:
                    break
                # item is already bytes from _execute_code_streaming's wfile.write
                if isinstance(item, bytes):
                    yield item
                else:
                    yield item.encode() if isinstance(item, str) else item

        return Response(
            stream_with_context(generate()),
            content_type='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            }
        )
    else:
        outputs = _execute_code(exp_id, code)
        return jsonify({'outputs': outputs})


@bp.route('/api/experiments/<exp_id>/kernel/restart', methods=['POST'])
@require_experiment_access
def restart_kernel(exp_id, google_id):
    """Restart an experiment's Jupyter kernel."""
    _kill_kernel(exp_id)
    _get_kernel(exp_id)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/kernel/interrupt', methods=['POST'])
@require_experiment_access
def interrupt_kernel(exp_id, google_id):
    """Interrupt an experiment's running kernel."""
    with _kernels_lock:
        entry = _kernels.get(exp_id)
    if entry and entry['km'].is_alive():
        try:
            entry['km'].interrupt_kernel()
            return jsonify({'ok': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        return jsonify({'error': 'No running kernel'}), 404


@bp.route('/api/experiments/<exp_id>/venv', methods=['POST'])
@require_experiment_access
def create_venv(exp_id, google_id):
    """Create a virtual environment for an experiment."""
    if not read_meta(exp_id):
        return jsonify({'error': 'Not found'}), 404
    try:
        python_path = _create_venv(exp_id)
        return jsonify({'ok': True, 'pythonPath': python_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/<exp_id>/packages', methods=['POST'])
@require_experiment_access
def install_packages(exp_id, google_id):
    """Install pip packages for an experiment."""
    if not read_meta(exp_id):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    packages_str = body.get('packages', '').strip()
    if not packages_str:
        return jsonify({'error': 'packages required'}), 400
    if not _validate_package_names(packages_str):
        return jsonify({'error': 'Invalid package name'}), 400
    python_path = _get_python_path(exp_id)
    pkg_list = packages_str.split()
    try:
        result = subprocess.run(
            [python_path, '-m', 'pip', 'install'] + pkg_list,
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            return jsonify({'error': result.stderr or result.stdout}), 500
        _kill_kernel(exp_id)
        return jsonify({'ok': True, 'output': result.stdout})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/<exp_id>/create-folder', methods=['POST'])
@require_experiment_access
def create_folder(exp_id, google_id):
    """Create a folder inside an experiment."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    name = body.get('name', '').strip()
    if not name or '..' in name or '/' in name:
        return jsonify({'error': 'Invalid folder name'}), 400
    folder_path = os.path.join(exp_dir, name)
    if os.path.exists(folder_path):
        return jsonify({'error': 'Folder already exists'}), 409
    os.makedirs(folder_path)
    return jsonify({'ok': True, 'name': name}), 201


@bp.route('/api/experiments/<exp_id>/delete-folder', methods=['POST'])
@require_experiment_access
def delete_folder(exp_id, google_id):
    """Delete a folder inside an experiment."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    folder = body.get('folder', '').strip()
    if not folder or '..' in folder or '/' in folder:
        return jsonify({'error': 'Invalid folder name'}), 400
    folder_path = os.path.join(exp_dir, folder)
    if not os.path.isdir(folder_path):
        return jsonify({'error': 'Folder not found'}), 404
    shutil.rmtree(folder_path)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/rename-folder', methods=['POST'])
@require_experiment_access
def rename_folder(exp_id, google_id):
    """Rename a folder inside an experiment."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    old_name = body.get('oldName', '').strip()
    new_name = body.get('newName', '').strip()
    if not old_name or '..' in old_name or '/' in old_name:
        return jsonify({'error': 'Invalid old folder name'}), 400
    if not new_name or '..' in new_name or '/' in new_name:
        return jsonify({'error': 'Invalid new folder name'}), 400
    old_path = os.path.join(exp_dir, old_name)
    new_path = os.path.join(exp_dir, new_name)
    if not os.path.isdir(old_path):
        return jsonify({'error': 'Folder not found'}), 404
    if os.path.exists(new_path):
        return jsonify({'error': 'A folder with that name already exists'}), 409
    os.rename(old_path, new_path)
    return jsonify({'ok': True, 'name': new_name})


@bp.route('/api/experiments/<exp_id>/move-file', methods=['POST'])
@require_experiment_access
def move_file(exp_id, google_id):
    """Move a file within an experiment."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    old_path = body.get('oldPath', '').strip()
    new_path = body.get('newPath', '').strip()
    if not old_path or '..' in old_path or not new_path or '..' in new_path:
        return jsonify({'error': 'Invalid path'}), 400
    src = os.path.join(exp_dir, old_path)
    dst = os.path.join(exp_dir, new_path)
    if not os.path.isfile(src):
        return jsonify({'error': 'Source file not found'}), 404
    if os.path.exists(dst):
        return jsonify({'error': 'Destination already exists'}), 409
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.rename(src, dst)
    return jsonify({'ok': True, 'name': new_path})


@bp.route('/api/experiments/<exp_id>/clone-repo', methods=['POST'])
@require_experiment_access
def clone_repo(exp_id, google_id):
    """Clone a GitHub repo into an experiment."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    url = body.get('url', '').strip()
    github_re = re.compile(r'^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$')
    if not github_re.match(url):
        return jsonify({'error': 'Invalid GitHub URL. Expected: https://github.com/user/repo'}), 400
    # Derive folder name from URL
    folder = url.rstrip('/').split('/')[-1]
    if folder.endswith('.git'):
        folder = folder[:-4]
    if not folder or '..' in folder:
        return jsonify({'error': 'Invalid repository URL'}), 400
    clone_dir = os.path.join(exp_dir, folder)
    if os.path.exists(clone_dir):
        return jsonify({'error': f'Folder "{folder}" already exists'}), 409
    try:
        result = subprocess.run(
            ['git', 'clone', '--depth', '1', url, folder],
            cwd=exp_dir, capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            # Clean up partial clone
            if os.path.exists(clone_dir):
                shutil.rmtree(clone_dir, ignore_errors=True)
            return jsonify({'error': result.stderr.strip() or 'Clone failed'}), 500
        # Remove .git directory -- we just want the files
        git_dir = os.path.join(clone_dir, '.git')
        if os.path.isdir(git_dir):
            shutil.rmtree(git_dir, ignore_errors=True)
        return jsonify({'folder': folder}), 201
    except subprocess.TimeoutExpired:
        if os.path.exists(clone_dir):
            shutil.rmtree(clone_dir, ignore_errors=True)
        return jsonify({'error': 'Clone timed out'}), 504
    except Exception as e:
        if os.path.exists(clone_dir):
            shutil.rmtree(clone_dir, ignore_errors=True)
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/move-unstructured-file', methods=['POST'])
@require_auth
def move_unstructured_file(google_id):
    """Move a file from _unstructured to a target experiment."""
    body = request.get_json(force=True, silent=True) or {}
    filename = body.get('filename', '').strip()
    target_exp = body.get('targetExp', '').strip()
    if not filename or not target_exp or '..' in filename or '..' in target_exp:
        return jsonify({'error': 'Invalid parameters'}), 400
    src = os.path.join(EXPERIMENTS_DIR, '_unstructured', filename)
    dst_dir = os.path.join(EXPERIMENTS_DIR, target_exp)
    if not os.path.isfile(src):
        return jsonify({'error': 'Source file not found'}), 404
    if not os.path.isdir(dst_dir):
        return jsonify({'error': 'Target experiment not found'}), 404
    dst = os.path.join(dst_dir, filename)
    if os.path.exists(dst):
        return jsonify({'error': 'File already exists in target project'}), 409
    shutil.move(src, dst)
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# PUT routes
# ---------------------------------------------------------------------------

@bp.route('/api/experiments/<exp_id>', methods=['PUT'])
@require_experiment_access
def update_experiment(exp_id, google_id):
    """Update experiment metadata (title, desc, pythonPath, papers)."""
    meta = read_meta(exp_id)
    if not meta:
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    if 'title' in body:
        meta['title'] = body['title']
    if 'desc' in body:
        meta['desc'] = body['desc']
    if 'pythonPath' in body:
        meta['pythonPath'] = body['pythonPath']
        _kill_kernel(exp_id)
    if 'papers' in body:
        meta['papers'] = body['papers']
    write_meta(exp_id, meta)
    meta['id'] = exp_id
    return jsonify(meta)


@bp.route('/api/experiments/<exp_id>/runs/<rid>', methods=['PUT'])
@require_experiment_access
def update_run(exp_id, google_id, rid):
    """Update a run within an experiment."""
    meta = read_meta(exp_id)
    if not meta:
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    for r in meta.get('runs', []):
        if r['id'] == rid:
            for key in ('name', 'status', 'notes', 'results', 'algorithm', 'environment', 'reward', 'episodes', 'hyperparameters'):
                if key in body:
                    r[key] = body[key]
            write_meta(exp_id, meta)
            return jsonify(r)
    return jsonify({'error': 'Run not found'}), 404


@bp.route('/api/experiments/<exp_id>/files/<path:fname>', methods=['PUT'])
@require_experiment_access
def update_file(exp_id, google_id, fname):
    """Update file content or rename a file."""
    fname = url_unquote(fname)
    if '..' in fname:
        return jsonify({'error': 'Invalid path'}), 400
    fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
    body = request.get_json(force=True, silent=True) or {}
    # Rename if 'rename' field is provided
    if 'rename' in body:
        if not os.path.isfile(fpath):
            return jsonify({'error': 'Not found'}), 404
        new_name = body['rename'].strip()
        if not new_name:
            return jsonify({'error': 'Name required'}), 400
        new_path = os.path.join(EXPERIMENTS_DIR, exp_id, new_name)
        if os.path.exists(new_path):
            return jsonify({'error': 'File already exists'}), 409
        os.rename(fpath, new_path)
        return jsonify({'ok': True, 'name': new_name})
    else:
        os.makedirs(os.path.dirname(fpath), exist_ok=True)
        with open(fpath, 'w') as f:
            f.write(body.get('content', ''))
        return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/team', methods=['PUT'])
@require_auth
def set_team(exp_id, google_id):
    """Assign an experiment to a team."""
    body = request.get_json(force=True, silent=True) or {}
    team_id = body.get('team_id')
    if team_id is None:
        return jsonify({'error': 'team_id required'}), 400
    if set_experiment_team(exp_id, int(team_id), google_id):
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Not a team member'}), 403


# ---------------------------------------------------------------------------
# DELETE routes
# ---------------------------------------------------------------------------

@bp.route('/api/experiments/<exp_id>', methods=['DELETE'])
@require_experiment_access
def delete_experiment(exp_id, google_id):
    """Delete an experiment and all its files."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    if os.path.isdir(exp_dir):
        _kill_kernel(exp_id)
        shutil.rmtree(exp_dir)
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/experiments/<exp_id>/runs/<rid>', methods=['DELETE'])
@require_experiment_access
def delete_run(exp_id, google_id, rid):
    """Delete a run from an experiment."""
    meta = read_meta(exp_id)
    if not meta:
        return jsonify({'error': 'Not found'}), 404
    meta['runs'] = [r for r in meta.get('runs', []) if r['id'] != rid]
    write_meta(exp_id, meta)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/files/<path:fname>', methods=['DELETE'])
@require_experiment_access
def delete_file(exp_id, google_id, fname):
    """Delete a file from an experiment."""
    fname = url_unquote(fname)
    if '..' in fname:
        return jsonify({'error': 'Invalid path'}), 400
    fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
    if os.path.isfile(fpath):
        os.remove(fpath)
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/experiments/<exp_id>/packages/<path:pkg>', methods=['DELETE'])
@require_experiment_access
def uninstall_package(exp_id, google_id, pkg):
    """Uninstall a pip package from an experiment."""
    if not read_meta(exp_id):
        return jsonify({'error': 'Not found'}), 404
    if not _validate_package_names(pkg):
        return jsonify({'error': 'Invalid package name'}), 400
    python_path = _get_python_path(exp_id)
    try:
        result = subprocess.run(
            [python_path, '-m', 'pip', 'uninstall', '-y', pkg],
            capture_output=True, text=True, timeout=60
        )
        _kill_kernel(exp_id)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/<exp_id>/venv', methods=['DELETE'])
@require_experiment_access
def delete_venv(exp_id, google_id):
    """Delete an experiment's virtual environment."""
    venv_dir = os.path.join(EXPERIMENTS_DIR, exp_id, 'venv')
    if not os.path.isdir(venv_dir):
        return jsonify({'error': 'No venv found'}), 404
    _kill_kernel(exp_id)
    shutil.rmtree(venv_dir)
    meta = read_meta(exp_id)
    if meta:
        meta['pythonPath'] = 'python3'
        write_meta(exp_id, meta)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/kernel', methods=['DELETE'])
@require_experiment_access
def kill_kernel(exp_id, google_id):
    """Kill an experiment's Jupyter kernel."""
    _kill_kernel(exp_id)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/team', methods=['DELETE'])
@require_auth
def remove_team(exp_id, google_id):
    """Remove an experiment from its team."""
    remove_experiment_team(exp_id)
    return jsonify({'ok': True})
