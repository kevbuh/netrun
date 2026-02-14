"""Experiment routes: venvs, packages, kernels, uploads, code execution, LaTeX compilation, repo cloning."""
import os
import json
import re
import shutil
import subprocess
import threading
import tempfile
from urllib.parse import unquote as url_unquote

from flask import Blueprint, request, jsonify, Response, stream_with_context

from helpers import require_auth
from db import get_vault_project_dir
from vault_helpers import _get_user_vault_path
from kernels import (
    _get_kernel, _kill_kernel, _get_python_path,
    _validate_package_names, _create_venv,
    _execute_code, _execute_code_streaming,
    _kernels, _kernels_lock,
)

bp = Blueprint('experiments', __name__)


def _require_project_access(f):
    """Decorator: require auth + resolve exp_dir from vault. Passes google_id=, exp_id=, exp_dir=.
    Special case: exp_id='_root' maps to the vault root itself (for loose files)."""
    from functools import wraps
    from users import get_session_user, touch_last_seen
    @wraps(f)
    def decorated(exp_id, *args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Not authenticated'}), 401
        google_id = get_session_user(auth[7:])
        if not google_id:
            return jsonify({'error': 'Invalid session'}), 401
        touch_last_seen(google_id)
        if exp_id == '_root':
            exp_dir = _get_user_vault_path(google_id)
        else:
            exp_dir = get_vault_project_dir(google_id, exp_id)
        if not exp_dir:
            return jsonify({'error': 'Invalid project path'}), 400
        return f(exp_id, *args, google_id=google_id, exp_dir=exp_dir, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# GET routes
# ---------------------------------------------------------------------------


@bp.route('/api/experiments/<exp_id>/compile-tex/<path:fname>', methods=['GET'])
@_require_project_access
def compile_tex(exp_id, google_id, exp_dir, fname):
    """Compile a LaTeX file and return the resulting PDF."""
    fname = url_unquote(fname)
    fpath = os.path.join(exp_dir, fname)
    if not os.path.isfile(fpath) or not fname.endswith('.tex'):
        return jsonify({'error': 'Not found'}), 404
    tmp = tempfile.mkdtemp()
    try:
        tex_basename = os.path.basename(fname)
        shutil.copy(fpath, os.path.join(tmp, tex_basename))
        tex_dir = os.path.dirname(fpath)
        for sf in os.listdir(tex_dir):
            if sf != tex_basename and (sf.endswith('.sty') or sf.endswith('.bst') or sf.endswith('.bib') or (sf.endswith('.tex') and sf != tex_basename)):
                src = os.path.join(tex_dir, sf)
                if os.path.isfile(src):
                    shutil.copy(src, tmp)
        if not any(f.endswith('.sty') for f in os.listdir(tmp)):
            sty_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'neurips_2023.sty')
            if not os.path.isfile(sty_path):
                sty_path = os.path.join(os.path.dirname(__file__), '..', 'neurips_2023.sty')
            if os.path.isfile(sty_path):
                shutil.copy(sty_path, tmp)
        result = subprocess.run(
            ['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
            cwd=tmp, capture_output=True, text=True, timeout=30
        )
        aux_name = tex_basename.rsplit('.', 1)[0]
        if any(f.endswith('.bib') for f in os.listdir(tmp)):
            subprocess.run(['bibtex', aux_name], cwd=tmp, capture_output=True, text=True, timeout=15)
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
@_require_project_access
def list_packages(exp_id, google_id, exp_dir):
    """List pip packages for a project."""
    python_path = _get_python_path(exp_dir)
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
@_require_project_access
def venv_info(exp_id, google_id, exp_dir):
    """Get venv details: pythonVersion, diskSize, packageCount."""
    python_path = _get_python_path(exp_dir)
    venv_dir = os.path.join(exp_dir, 'venv')
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
    """List all projects that have venvs."""
    vault = _get_user_vault_path(google_id)
    venvs = []
    if os.path.isdir(vault):
        for name in sorted(os.listdir(vault)):
            full = os.path.join(vault, name)
            if not os.path.isdir(full):
                continue
            venv_python = os.path.join(full, 'venv', 'bin', 'python')
            if os.path.exists(venv_python):
                venvs.append({'id': name, 'title': name, 'pythonPath': venv_python})
    return jsonify(venvs)


# ---------------------------------------------------------------------------
# POST routes
# ---------------------------------------------------------------------------


@bp.route('/api/experiments/<exp_id>/upload', methods=['POST'])
@_require_project_access
def upload_file(exp_id, google_id, exp_dir):
    """Multipart file upload to a project."""
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    content_type = request.headers.get('Content-Type', '')
    if 'multipart/form-data' not in content_type:
        return jsonify({'error': 'multipart/form-data required'}), 400
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
        header_end = part.find(b'\r\n\r\n')
        if header_end == -1:
            continue
        headers_raw = part[:header_end].decode('utf-8', errors='replace')
        file_data = part[header_end + 4:]
        if file_data.endswith(b'\r\n'):
            file_data = file_data[:-2]
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
@_require_project_access
def execute_code(exp_id, google_id, exp_dir):
    """Execute code in a project's kernel (streaming SSE or synchronous)."""
    if not os.path.isdir(exp_dir):
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
                    _execute_code_streaming(exp_dir, code, fake, lambda: connected[0])
                except Exception:
                    pass
                q.put(None)  # sentinel

            t = threading.Thread(target=run, daemon=True)
            t.start()
            while True:
                item = q.get()
                if item is None:
                    break
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
        outputs = _execute_code(exp_dir, code)
        return jsonify({'outputs': outputs})


@bp.route('/api/experiments/<exp_id>/kernel/restart', methods=['POST'])
@_require_project_access
def restart_kernel(exp_id, google_id, exp_dir):
    """Restart a project's Jupyter kernel."""
    _kill_kernel(exp_dir)
    _get_kernel(exp_dir)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/kernel/interrupt', methods=['POST'])
@_require_project_access
def interrupt_kernel(exp_id, google_id, exp_dir):
    """Interrupt a project's running kernel."""
    with _kernels_lock:
        entry = _kernels.get(exp_dir)
    if entry and entry['km'].is_alive():
        try:
            entry['km'].interrupt_kernel()
            return jsonify({'ok': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        return jsonify({'error': 'No running kernel'}), 404


@bp.route('/api/experiments/<exp_id>/venv', methods=['POST'])
@_require_project_access
def create_venv(exp_id, google_id, exp_dir):
    """Create a virtual environment for a project."""
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    try:
        python_path = _create_venv(exp_dir)
        return jsonify({'ok': True, 'pythonPath': python_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/<exp_id>/packages', methods=['POST'])
@_require_project_access
def install_packages(exp_id, google_id, exp_dir):
    """Install pip packages for a project."""
    body = request.get_json(force=True, silent=True) or {}
    packages_str = body.get('packages', '').strip()
    if not packages_str:
        return jsonify({'error': 'packages required'}), 400
    if not _validate_package_names(packages_str):
        return jsonify({'error': 'Invalid package name'}), 400
    python_path = _get_python_path(exp_dir)
    pkg_list = packages_str.split()
    try:
        result = subprocess.run(
            [python_path, '-m', 'pip', 'install'] + pkg_list,
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            return jsonify({'error': result.stderr or result.stdout}), 500
        _kill_kernel(exp_dir)
        return jsonify({'ok': True, 'output': result.stdout})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/<exp_id>/clone-repo', methods=['POST'])
@_require_project_access
def clone_repo(exp_id, google_id, exp_dir):
    """Clone a GitHub repo into a project."""
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    url = body.get('url', '').strip()
    github_re = re.compile(r'^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$')
    if not github_re.match(url):
        return jsonify({'error': 'Invalid GitHub URL. Expected: https://github.com/user/repo'}), 400
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
            if os.path.exists(clone_dir):
                shutil.rmtree(clone_dir, ignore_errors=True)
            return jsonify({'error': result.stderr.strip() or 'Clone failed'}), 500
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


# ---------------------------------------------------------------------------
# PUT routes
# ---------------------------------------------------------------------------

@bp.route('/api/experiments/<exp_id>', methods=['PUT'])
@_require_project_access
def update_experiment(exp_id, google_id, exp_dir):
    """Update project — currently supports renaming via title."""
    if not os.path.isdir(exp_dir):
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json(force=True, silent=True) or {}
    if 'pythonPath' in body:
        _kill_kernel(exp_dir)
    return jsonify({'id': exp_id, 'title': exp_id, 'desc': '', 'runs': []})


# ---------------------------------------------------------------------------
# DELETE routes
# ---------------------------------------------------------------------------

@bp.route('/api/experiments/<exp_id>/packages/<path:pkg>', methods=['DELETE'])
@_require_project_access
def uninstall_package(exp_id, google_id, exp_dir, pkg):
    """Uninstall a pip package from a project."""
    if not _validate_package_names(pkg):
        return jsonify({'error': 'Invalid package name'}), 400
    python_path = _get_python_path(exp_dir)
    try:
        result = subprocess.run(
            [python_path, '-m', 'pip', 'uninstall', '-y', pkg],
            capture_output=True, text=True, timeout=60
        )
        _kill_kernel(exp_dir)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/experiments/<exp_id>/venv', methods=['DELETE'])
@_require_project_access
def delete_venv(exp_id, google_id, exp_dir):
    """Delete a project's virtual environment."""
    venv_dir = os.path.join(exp_dir, 'venv')
    if not os.path.isdir(venv_dir):
        return jsonify({'error': 'No venv found'}), 404
    _kill_kernel(exp_dir)
    shutil.rmtree(venv_dir)
    return jsonify({'ok': True})


@bp.route('/api/experiments/<exp_id>/kernel', methods=['DELETE'])
@_require_project_access
def kill_kernel(exp_id, google_id, exp_dir):
    """Kill a project's Jupyter kernel."""
    _kill_kernel(exp_dir)
    return jsonify({'ok': True})
