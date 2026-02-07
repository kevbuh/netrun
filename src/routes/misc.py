"""Misc routes: neuralook (SSE), transcribe, vibe/git, reveal-in-finder, settings, version, dev-stats,
calendar, todos, images, saved-posts, custom-feeds, tex-preview, local-file, arxiv-pdf."""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

from flask import Blueprint, request, jsonify, Response, stream_with_context

from helpers import require_auth, sse_event
from persistence import (
    DIR, EXPERIMENTS_DIR,
    read_saved_content, write_saved_content,
    get_user_calendar, create_calendar_event, update_calendar_event, delete_calendar_event,
    get_user_todos, create_todo, update_todo, delete_todo,
    get_all_user_data, set_user_data,
)
from vault_helpers import _get_user_vault_path, _vibe_run_git

bp = Blueprint('misc', __name__)

UPLOADS_DIR = os.path.join(DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Neuralook state
_neuralook_models = {}
_neuralook_screen = None
_whisper_model = None


@bp.route('/api/settings')
def settings():
    return jsonify({'ok': True})


@bp.route('/api/version')
def version():
    try:
        git_root = os.path.dirname(DIR)
        r = subprocess.run(['git', 'rev-list', '--count', 'HEAD'],
                           capture_output=True, text=True, cwd=git_root, timeout=5)
        count = int(r.stdout.strip()) if r.returncode == 0 else 0
        h = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                           capture_output=True, text=True, cwd=git_root, timeout=5)
        sha = h.stdout.strip() if h.returncode == 0 else ''
        return jsonify({'version': f'0.{count}', 'sha': sha})
    except Exception:
        return jsonify({'version': '0.0', 'sha': ''})


@bp.route('/api/dev-stats')
def dev_stats():
    try:
        from persistence import _get_db
        conn = _get_db()
        users = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        active_sessions = conn.execute('SELECT COUNT(*) FROM sessions WHERE expires > ?', (time.time(),)).fetchone()[0]
        conn.close()
        total_loc = 0
        file_count = 0
        for root, dirs, files in os.walk(DIR):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', '__pycache__', 'experiments', 'uploads')]
            for f in files:
                if f.endswith(('.js', '.py', '.css', '.html')):
                    try:
                        with open(os.path.join(root, f), 'r', errors='ignore') as fh:
                            total_loc += sum(1 for _ in fh)
                        file_count += 1
                    except Exception:
                        pass
        commits_today = 0
        git_root = os.path.dirname(DIR)
        try:
            today = time.strftime('%Y-%m-%d')
            result = subprocess.run(['git', 'rev-list', '--count', '--since=' + today, 'HEAD'],
                                    capture_output=True, text=True, cwd=git_root)
            commits_today = int(result.stdout.strip()) if result.returncode == 0 else 0
        except Exception:
            pass
        # LOC history
        loc_history = []
        try:
            result = subprocess.run(
                ['git', 'log', '--reverse', '--format=%H %ad', '--date=short', '--since=30 days ago'],
                capture_output=True, text=True, cwd=git_root)
            if result.returncode == 0:
                day_commits = {}
                for line in result.stdout.strip().split('\n'):
                    if not line.strip():
                        continue
                    parts = line.split(' ', 1)
                    if len(parts) == 2:
                        day_commits[parts[1]] = parts[0]
                day_stats = {}
                stat_result = subprocess.run(
                    ['git', 'log', '--numstat', '--format=%ad', '--date=short', '--since=30 days ago', '--', 'src/'],
                    capture_output=True, text=True, cwd=git_root, timeout=30)
                if stat_result.returncode == 0:
                    current_date = None
                    for sline in stat_result.stdout.split('\n'):
                        sline = sline.strip()
                        if not sline:
                            continue
                        if re.match(r'^\d{4}-\d{2}-\d{2}$', sline):
                            current_date = sline
                            if current_date not in day_stats:
                                day_stats[current_date] = {'added': 0, 'deleted': 0}
                        elif current_date and '\t' in sline:
                            parts3 = sline.split('\t')
                            if len(parts3) >= 3:
                                try:
                                    day_stats[current_date]['added'] += int(parts3[0])
                                    day_stats[current_date]['deleted'] += int(parts3[1])
                                except (ValueError, IndexError):
                                    pass
                for date in sorted(day_commits.keys()):
                    sha = day_commits[date]
                    lines = 0
                    try:
                        r = subprocess.run(['git', 'ls-tree', '-r', '--name-only', sha, 'src/'],
                                           capture_output=True, text=True, cwd=git_root, timeout=5)
                        if r.returncode == 0:
                            for fp in r.stdout.strip().split('\n'):
                                if fp and fp.endswith(('.js', '.py', '.css', '.html')):
                                    try:
                                        cr = subprocess.run(['git', 'show', sha + ':' + fp],
                                                            capture_output=True, text=True, cwd=git_root, timeout=5)
                                        if cr.returncode == 0:
                                            lines += cr.stdout.count('\n')
                                    except Exception:
                                        pass
                    except Exception:
                        pass
                    ds = day_stats.get(date, {})
                    loc_history.append({
                        'date': date, 'lines': lines,
                        'added': ds.get('added', 0),
                        'deleted': ds.get('deleted', 0),
                    })
        except Exception:
            pass
        usage_history = {}
        try:
            from persistence import get_usage_history
            usage_history = get_usage_history(30)
        except Exception:
            pass
        git_log = []
        try:
            r = subprocess.run(
                ['git', 'log', '--format=%H|%an|%ad|%s', '--date=iso'],
                capture_output=True, text=True, cwd=git_root, timeout=10)
            if r.returncode == 0:
                for line in r.stdout.strip().split('\n'):
                    if not line.strip():
                        continue
                    parts = line.split('|', 3)
                    if len(parts) == 4:
                        git_log.append({'sha': parts[0][:8], 'author': parts[1], 'date': parts[2], 'message': parts[3]})
        except Exception:
            pass
        commits_per_day = []
        try:
            r = subprocess.run(
                ['git', 'log', '--format=%ad', '--date=short', '--since=30 days ago'],
                capture_output=True, text=True, cwd=git_root, timeout=10)
            if r.returncode == 0:
                from collections import Counter
                counts = Counter(d.strip() for d in r.stdout.strip().split('\n') if d.strip())
                for date in sorted(counts.keys()):
                    commits_per_day.append({'date': date, 'count': counts[date]})
        except Exception:
            pass
        # RAM usage (this process)
        import resource
        ram_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)  # macOS returns bytes
        # Disk usage
        disk = shutil.disk_usage('/')
        disk_total_gb = round(disk.total / (1024**3), 1)
        disk_used_gb = round(disk.used / (1024**3), 1)
        disk_free_gb = round(disk.free / (1024**3), 1)
        # Project size
        project_bytes = 0
        for root2, dirs2, files2 in os.walk(DIR):
            dirs2[:] = [d for d in dirs2 if d not in ('node_modules', '.git', '__pycache__', 'experiments', 'uploads')]
            for f2 in files2:
                try:
                    project_bytes += os.path.getsize(os.path.join(root2, f2))
                except OSError:
                    pass
        project_mb = round(project_bytes / (1024**2), 1)

        return jsonify({
            'users': users,
            'active_sessions': active_sessions,
            'total_loc': total_loc,
            'files': file_count,
            'commits_today': commits_today,
            'loc_history': loc_history,
            'usage_history': usage_history,
            'git_log': git_log,
            'commits_per_day': commits_per_day,
            'ram_mb': round(ram_mb, 1),
            'disk_total_gb': disk_total_gb,
            'disk_used_gb': disk_used_gb,
            'disk_free_gb': disk_free_gb,
            'project_mb': project_mb,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/todos')
@require_auth
def list_todos(google_id):
    return jsonify(get_user_todos(google_id))


@bp.route('/api/todos', methods=['POST'])
@require_auth
def create_todo_route(google_id):
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    if not title:
        return jsonify({'error': 'title required'}), 400
    todo = create_todo(google_id, body)
    return jsonify(todo), 201


@bp.route('/api/todos/<tid>', methods=['PUT'])
@require_auth
def update_todo_route(google_id, tid):
    body = request.get_json(force=True, silent=True) or {}
    result = update_todo(google_id, tid, body)
    if result:
        return jsonify(result)
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/todos/<tid>', methods=['DELETE'])
@require_auth
def delete_todo_route(google_id, tid):
    if delete_todo(google_id, tid):
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/calendar')
@require_auth
def list_calendar(google_id):
    return jsonify(get_user_calendar(google_id))


@bp.route('/api/calendar', methods=['POST'])
@require_auth
def create_calendar_event_route(google_id):
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    if not title:
        return jsonify({'error': 'title required'}), 400
    event = create_calendar_event(google_id, body)
    return jsonify(event), 201


@bp.route('/api/calendar/<eid>', methods=['PUT'])
@require_auth
def update_calendar_event_route(google_id, eid):
    body = request.get_json(force=True, silent=True) or {}
    result = update_calendar_event(google_id, eid, body)
    if result:
        return jsonify(result)
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/calendar/<eid>', methods=['DELETE'])
@require_auth
def delete_calendar_event_route(google_id, eid):
    if delete_calendar_event(google_id, eid):
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Not found'}), 404


@bp.route('/api/images', methods=['POST'])
@require_auth
def upload_image(google_id):
    try:
        body = request.get_json(force=True, silent=True) or {}
        image_b64 = body.get('image', '')
        if not image_b64:
            return jsonify({'error': 'image required'}), 400
        filename = str(uuid.uuid4()) + '.png'
        filepath = os.path.join(UPLOADS_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(image_b64))
        return jsonify({'url': '/api/images/' + filename})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/images/<filename>')
def serve_image(filename):
    filename = os.path.basename(filename)
    filepath = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(filepath):
        return Response(status=404)
    with open(filepath, 'rb') as f:
        data = f.read()
    resp = Response(data, content_type='image/png')
    resp.headers['Cache-Control'] = 'public, max-age=31536000'
    return resp


@bp.route('/api/saved-content')
@require_auth
def get_saved_content(google_id):
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400
    data = read_saved_content(url)
    if data is None:
        return jsonify({'error': 'not found'}), 404
    else:
        return jsonify(data)


@bp.route('/api/saved-content', methods=['POST'])
@require_auth
def post_saved_content(google_id):
    body = request.get_json(force=True, silent=True) or {}
    url = body.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400
    write_saved_content(url, {
        'url': url,
        'title': body.get('title', ''),
        'text': body.get('text', ''),
        'savedAt': body.get('savedAt', int(time.time() * 1000))
    })
    return jsonify({'ok': True})


@bp.route('/api/saved-posts', methods=['POST'])
@require_auth
def save_post(google_id):
    body = request.get_json(force=True, silent=True) or {}
    url = body.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400
    title = body.get('title', url)
    favicon = body.get('favicon', '')
    hostname = body.get('hostname', '')
    data = get_all_user_data(google_id)
    saved = data.get('savedPosts', {}).get('value', {})
    if isinstance(saved, str):
        try:
            saved = json.loads(saved)
        except Exception:
            saved = {}
    if url in saved:
        return jsonify({'exists': True})
    saved[url] = {
        'paper': {'title': title, 'link': url, 'favicon': favicon, 'hostname': hostname},
        'savedAt': int(time.time() * 1000),
        'read': False
    }
    set_user_data(google_id, 'savedPosts', saved)
    return jsonify({'ok': True})


@bp.route('/api/custom-feeds', methods=['POST'])
@require_auth
def add_custom_feed(google_id):
    body = request.get_json(force=True, silent=True) or {}
    url = (body.get('url') or '').strip()
    name = (body.get('name') or '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400
    data = get_all_user_data(google_id)
    feeds = data.get('customFeeds', {}).get('value', [])
    if isinstance(feeds, str):
        try:
            feeds = json.loads(feeds)
        except Exception:
            feeds = []
    if not isinstance(feeds, list):
        feeds = []
    if any(f.get('url') == url for f in feeds):
        return jsonify({'exists': True})
    feeds.append({'url': url, 'name': name or url, 'enabled': True})
    set_user_data(google_id, 'customFeeds', feeds)
    return jsonify({'ok': True, 'name': name or url})


@bp.route('/api/reveal-in-finder', methods=['POST'])
@require_auth
def reveal_in_finder(google_id):
    body = request.get_json(force=True, silent=True) or {}
    filename = body.get('filename', '').strip()
    if not filename:
        return jsonify({'error': 'Missing filename'}), 400
    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
    filepath = os.path.join(downloads_dir, filename)
    if os.path.exists(filepath):
        subprocess.Popen(['open', '-R', filepath])
        return jsonify({'ok': True})
    else:
        subprocess.Popen(['open', downloads_dir])
        return jsonify({'ok': True, 'fallback': True})


@bp.route('/api/vibe/git', methods=['POST'])
@require_auth
def vibe_git(google_id):
    body = request.get_json(force=True, silent=True) or {}
    cmd = body.get('cmd', '')
    user_vault = _get_user_vault_path(google_id)
    ALLOWED = {'status', 'files', 'branches', 'log', 'stash', 'diff', 'show', 'reflog'}
    if cmd not in ALLOWED:
        return jsonify({'error': 'Command not allowed'}), 400
    try:
        result = _vibe_run_git(cmd, body, user_vault)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/local-file')
@require_auth
def local_file(google_id):
    from urllib.parse import unquote
    import mimetypes
    file_path = unquote(request.args.get('path', '')).strip()
    if not file_path or not os.path.isfile(file_path):
        return Response(b'File not found', status=404, content_type='text/plain')
    ct = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
    try:
        with open(file_path, 'rb') as f:
            data = f.read()
        resp = Response(data, content_type=ct)
        resp.headers['Content-Length'] = str(len(data))
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp
    except Exception as e:
        return Response(str(e).encode(), status=500, content_type='text/plain')


@bp.route('/api/arxiv-pdf')
def arxiv_pdf():
    import ssl
    import urllib.request
    arxiv_id = request.args.get('id', '').strip()
    if not arxiv_id:
        return Response(status=400)
    pdf_url = f'https://arxiv.org/pdf/{arxiv_id}.pdf'
    try:
        req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            data = resp.read()
            r = Response(data, content_type='application/pdf')
            r.headers['Content-Length'] = str(len(data))
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r
    except Exception as e:
        return Response(str(e).encode(), status=502, content_type='text/plain')


@bp.route('/tex-preview')
def tex_preview():
    html = b'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LaTeX Preview</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#1a1a1a;font-family:system-ui,sans-serif;color:#aaa}
#pdf-frame{width:100%;height:100%;border:none;display:none}
#placeholder{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px}
#placeholder .spinner{width:24px;height:24px;border:2px solid #444;border-top-color:#b4451a;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<iframe id="pdf-frame"></iframe>
<div id="placeholder"><div class="spinner"></div><span>Waiting for compilation...</span></div>
<script>
const ch = new BroadcastChannel('tex-pdf-preview');
const frame = document.getElementById('pdf-frame');
const ph = document.getElementById('placeholder');
let currentUrl = null;
ch.onmessage = function(e) {
  if (e.data && e.data.type === 'pdf-update') {
    const bytes = new Uint8Array(e.data.pdf);
    const blob = new Blob([bytes], {type:'application/pdf'});
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    frame.src = currentUrl;
    frame.style.display = 'block';
    ph.style.display = 'none';
    document.title = 'LaTeX Preview' + (e.data.fname ? ' - ' + e.data.fname : '');
  }
};
ch.postMessage({type:'preview-ready'});
</script></body></html>'''
    return Response(html, content_type='text/html; charset=utf-8')


@bp.route('/api/transcribe', methods=['POST'])
@require_auth
def transcribe(google_id):
    length = int(request.headers.get('Content-Length', 0))
    if length == 0:
        return jsonify({'error': 'No audio data'}), 400
    audio_data = request.get_data()
    try:
        from pywhispercpp.model import Model as WhisperModel
        global _whisper_model
        if _whisper_model is None:
            _whisper_model = WhisperModel('tiny')
        uid = uuid.uuid4().hex
        tmp_webm = os.path.join(tempfile.gettempdir(), f'whisper_{uid}.webm')
        tmp_wav = os.path.join(tempfile.gettempdir(), f'whisper_{uid}.wav')
        with open(tmp_webm, 'wb') as f:
            f.write(audio_data)
        subprocess.run(['ffmpeg', '-y', '-i', tmp_webm, '-ar', '16000', '-ac', '1', '-f', 'wav', tmp_wav],
                       capture_output=True, timeout=30)
        segments = _whisper_model.transcribe(tmp_wav)
        text = ' '.join(seg.text.strip() for seg in segments).strip()
        os.remove(tmp_webm)
        os.remove(tmp_wav)
        return jsonify({'text': text})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/neuralook/calibration')
@require_auth
def get_calibration(google_id):
    calib_path = os.path.join(DIR, 'neuralook_calibration.json')
    if os.path.exists(calib_path):
        with open(calib_path, 'r') as f:
            return jsonify(json.loads(f.read()))
    else:
        return jsonify({'error': 'No calibration data saved'}), 404


@bp.route('/api/neuralook/save-calibration', methods=['POST'])
@require_auth
def save_calibration(google_id):
    body = request.get_json(force=True, silent=True) or {}
    calib_path = os.path.join(DIR, 'neuralook_calibration.json')
    try:
        with open(calib_path, 'w') as f:
            json.dump(body, f)
        return jsonify({'ok': True, 'samples': len(body.get('samples', []))})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/neuralook/train', methods=['POST'])
@require_auth
def neuralook_train(google_id):
    global _neuralook_models, _neuralook_screen
    body = request.get_json(force=True, silent=True) or {}

    def generate():
        global _neuralook_models, _neuralook_screen
        try:
            import torch
            import torch.nn as nn
            import random

            method = body.get('method', 'cnn')
            samples = body.get('samples', [])
            if not samples:
                calib_path = os.path.join(DIR, 'neuralook_calibration.json')
                if os.path.exists(calib_path):
                    with open(calib_path, 'r') as f:
                        calib = json.loads(f.read())
                    samples = calib.get('samples', [])
                    body.setdefault('screenW', calib.get('screenW', 1920))
                    body.setdefault('screenH', calib.get('screenH', 1080))
                    body.setdefault('eyeW', calib.get('eyeW', 64))
                    body.setdefault('eyeH', calib.get('eyeH', 32))

            screen_w = body.get('screenW', 1920)
            screen_h = body.get('screenH', 1080)
            eye_w = body.get('eyeW', 64)
            eye_h = body.get('eyeH', 32)
            if len(samples) < 10:
                yield sse_event('error', {'error': f'Need at least 10 samples, got {len(samples)}'})
                return

            eye_size = eye_w * eye_h
            X_list, Y_list, H_list = [], [], []
            for s in samples:
                raw = s['eyeData']
                if len(raw) != eye_size * 2:
                    continue
                left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                X_list.append(torch.cat([left, right], dim=0))
                Y_list.append([s['screenX'] / screen_w, s['screenY'] / screen_h])
                hp = s.get('headPose', [0, 0, 0])
                H_list.append(hp if len(hp) == 3 else [0, 0, 0])

            if len(X_list) < 10:
                yield sse_event('error', {'error': f'Only {len(X_list)} valid samples'})
                return

            X = torch.stack(X_list)
            Y = torch.tensor(Y_list, dtype=torch.float32)
            H = torch.tensor(H_list, dtype=torch.float32)

            targets_rounded = [(round(s['screenX']), round(s['screenY'])) for s in samples if len(s['eyeData']) == eye_size * 2]
            unique_targets = list(set(targets_rounded))
            n_val_points = max(2, len(unique_targets) // 4)
            random.shuffle(unique_targets)
            val_targets = set(unique_targets[:n_val_points])
            val_mask = torch.tensor([t in val_targets for t in targets_rounded])
            train_mask = ~val_mask

            X_train, Y_train = X[train_mask], Y[train_mask]
            X_val, Y_val = X[val_mask], Y[val_mask]
            H_train, H_val = H[train_mask], H[val_mask]

            class GazeCNN(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.features = nn.Sequential(
                        nn.Conv2d(2, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
                        nn.MaxPool2d(2),
                        nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
                        nn.MaxPool2d(2),
                        nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
                        nn.AdaptiveAvgPool2d((4, 4)),
                    )
                    self.head = nn.Sequential(
                        nn.Flatten(),
                        nn.Linear(128 * 4 * 4, 256), nn.ReLU(), nn.Dropout(0.3),
                        nn.Linear(256, 64), nn.ReLU(), nn.Dropout(0.3),
                        nn.Linear(64, 2)
                    )
                def forward(self, x):
                    return self.head(self.features(x))

            class GazeCNNHeadPose(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.features = nn.Sequential(
                        nn.Conv2d(2, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
                        nn.MaxPool2d(2),
                        nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
                        nn.MaxPool2d(2),
                        nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
                        nn.AdaptiveAvgPool2d((4, 4)),
                    )
                    self.flatten = nn.Flatten()
                    self.head = nn.Sequential(
                        nn.Linear(2048 + 3, 256), nn.ReLU(), nn.Dropout(0.3),
                        nn.Linear(256, 64), nn.ReLU(), nn.Dropout(0.3),
                        nn.Linear(64, 2)
                    )
                def forward(self, x, head_pose=None):
                    feat = self.flatten(self.features(x))
                    if head_pose is not None:
                        feat = torch.cat([feat, head_pose], dim=1)
                    else:
                        feat = torch.cat([feat, torch.zeros(x.shape[0], 3)], dim=1)
                    return self.head(feat)

            is_headpose = method == 'cnn_headpose'
            model = GazeCNNHeadPose() if is_headpose else GazeCNN()
            optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
            max_epochs = 50
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max_epochs)
            n_train = X_train.shape[0]
            batch_size = min(64, n_train)
            best_val_loss = float('inf')
            best_state = None
            patience = 30
            no_improve = 0
            stopped_epoch = 0

            wb = None
            wb_url = None
            try:
                import wandb
                wandb.init(project='neuralook', mode='online', config={
                    'architecture': 'GazeCNNHeadPose' if is_headpose else 'GazeCNN',
                    'method': method, 'eye_w': eye_w, 'eye_h': eye_h,
                    'n_samples': len(X_list), 'n_train': int(train_mask.sum()),
                    'n_val': int(val_mask.sum()), 'n_cal_points': len(unique_targets),
                    'n_val_points': n_val_points, 'lr': 1e-3, 'weight_decay': 1e-4,
                    'batch_size': batch_size, 'max_epochs': max_epochs, 'patience': patience,
                    'dropout': 0.3, 'screen_w': screen_w, 'screen_h': screen_h,
                })
                wandb.watch(model, log='all', log_freq=50)
                wb = wandb
                wb_url = wandb.run.get_url() if wandb.run else None
            except (ImportError, Exception):
                pass

            yield sse_event('progress', {'epoch': 0, 'max_epochs': max_epochs, 'phase': 'training', 'val_loss': None})

            n_params = sum(p.numel() for p in model.parameters())
            arch_name = 'GazeCNNHeadPose' if is_headpose else 'GazeCNN'
            yield sse_event('log', {'text': f'{arch_name} | params: {n_params:,} | input: [B, 2, {eye_h}, {eye_w}]{" + [B, 3] head pose" if is_headpose else ""}'})
            yield sse_event('log', {'text': f'  features: Conv2d(2→32) → BN → Pool → Conv2d(32→64) → BN → Pool → Conv2d(64→128) → BN → AdaptivePool(4,4)'})
            fc_in = '2048+3' if is_headpose else '2048'
            yield sse_event('log', {'text': f'  head: Flatten → Linear({fc_in},256) → ReLU → Drop(0.3) → Linear(256,64) → ReLU → Drop(0.3) → Linear(64,2)'})
            yield sse_event('log', {'text': f'Adam(lr=1e-3, weight_decay=1e-4) + CosineAnnealingLR(T_max={max_epochs})'})
            yield sse_event('log', {'text': f'train: {int(train_mask.sum())} samples ({len(unique_targets) - n_val_points} points) | val: {int(val_mask.sum())} samples ({n_val_points} points)'})
            yield sse_event('log', {'text': f'batch_size={batch_size} | patience={patience} | max_epochs={max_epochs}'})
            if wb_url:
                yield sse_event('log', {'text': f'wandb: {wb_url}'})
                yield sse_event('wandb', {'url': wb_url})
            yield sse_event('log', {'text': ''})
            yield sse_event('log', {'text': f'{"epoch":>6}  {"train_loss":>11}  {"val_loss":>11}  {"lr":>10}  {"best":>5}  {"patience":>8}'})
            yield sse_event('log', {'text': '─' * 65})

            last_train_loss = 0.0
            for epoch in range(max_epochs):
                model.train()
                perm = torch.randperm(n_train)
                epoch_loss = 0.0
                n_batches = 0
                for start in range(0, n_train, batch_size):
                    idx = perm[start:start + batch_size]
                    pred = model(X_train[idx], H_train[idx]) if is_headpose else model(X_train[idx])
                    loss = nn.functional.mse_loss(pred, Y_train[idx])
                    optimizer.zero_grad()
                    loss.backward()
                    optimizer.step()
                    epoch_loss += loss.item()
                    n_batches += 1
                last_train_loss = epoch_loss / max(n_batches, 1)
                scheduler.step()

                if epoch % 10 == 0:
                    model.eval()
                    with torch.no_grad():
                        val_pred = model(X_val, H_val) if is_headpose else model(X_val)
                        val_loss = nn.functional.mse_loss(val_pred, Y_val).item()
                    improved = val_loss < best_val_loss
                    if improved:
                        best_val_loss = val_loss
                        best_state = {k: v.clone() for k, v in model.state_dict().items()}
                        no_improve = 0
                    else:
                        no_improve += 10
                    cur_lr = optimizer.param_groups[0]['lr']
                    yield sse_event('log', {'text': f'{epoch:>6}  {last_train_loss:>11.6f}  {val_loss:>11.6f}  {cur_lr:>10.2e}  {"✓" if improved else " ":>5}  {no_improve:>4}/{patience}'})
                    yield sse_event('progress', {'epoch': epoch, 'max_epochs': max_epochs, 'val_loss': round(val_loss, 6), 'train_loss': round(last_train_loss, 6), 'phase': 'training'})
                    if wb:
                        wb.log({'epoch': epoch, 'train_loss': last_train_loss, 'val_loss': val_loss, 'lr': cur_lr, 'best_val_loss': best_val_loss, 'no_improve': no_improve})
                    if no_improve >= patience:
                        yield sse_event('log', {'text': f'\nEarly stopping at epoch {epoch} (no improvement for {patience} epochs)'})
                        stopped_epoch = epoch
                        break
                stopped_epoch = epoch

            if best_state:
                model.load_state_dict(best_state)
                yield sse_event('log', {'text': f'Restored best model (val_loss={best_val_loss:.6f})'})
            model.eval()
            yield sse_event('log', {'text': ''})
            yield sse_event('log', {'text': 'Evaluating on train/val sets...'})
            yield sse_event('progress', {'epoch': stopped_epoch, 'max_epochs': max_epochs, 'phase': 'evaluating'})

            with torch.no_grad():
                train_pred = model(X_train, H_train) if is_headpose else model(X_train)
                tp = train_pred.clone(); tp[:, 0] *= screen_w; tp[:, 1] *= screen_h
                yt = Y_train.clone(); yt[:, 0] *= screen_w; yt[:, 1] *= screen_h
                train_err = torch.sqrt(((tp - yt) ** 2).sum(dim=1)).mean().item()
                vp = model(X_val, H_val) if is_headpose else model(X_val)
                vp2 = vp.clone(); vp2[:, 0] *= screen_w; vp2[:, 1] *= screen_h
                yv = Y_val.clone(); yv[:, 0] *= screen_w; yv[:, 1] *= screen_h
                val_err = torch.sqrt(((vp2 - yv) ** 2).sum(dim=1)).mean().item()

            _neuralook_models[method] = model
            _neuralook_screen = (screen_w, screen_h, eye_w, eye_h)

            yield sse_event('log', {'text': f'  train error: {train_err:.1f}px'})
            yield sse_event('log', {'text': f'  val error:   {val_err:.1f}px'})
            qual = 'Good' if val_err < 80 else 'Fair' if val_err < 150 else 'Poor'
            yield sse_event('log', {'text': f'  quality:     {qual}'})
            yield sse_event('log', {'text': ''})
            yield sse_event('log', {'text': f'Done. Model ready for inference ({n_params:,} params, screen {screen_w}x{screen_h}).'})

            if wb:
                wb.summary['train_error_px'] = round(train_err, 1)
                wb.summary['val_error_px'] = round(val_err, 1)
                wb.summary['stopped_epoch'] = stopped_epoch
                wb.summary['best_val_loss'] = round(best_val_loss, 6)
                wb.summary['quality'] = qual
                wb.finish()
                yield sse_event('log', {'text': f'wandb: Run logged offline → wandb/latest-run'})

            yield sse_event('done', {
                'method': method,
                'train_error_px': round(train_err, 1),
                'val_error_px': round(val_err, 1),
                'stopped_epoch': stopped_epoch,
                'loss': round(best_val_loss, 6),
                'samples': len(X_list),
                'train_samples': int(train_mask.sum()),
                'val_samples': int(val_mask.sum()),
                'val_points': n_val_points
            })
        except ImportError:
            yield sse_event('error', {'error': 'PyTorch not installed on server'})
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield sse_event('error', {'error': str(e)})

    return Response(stream_with_context(generate()),
                    content_type='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive'})


@bp.route('/api/neuralook/predict', methods=['POST'])
@require_auth
def neuralook_predict(google_id):
    body = request.get_json(force=True, silent=True) or {}
    try:
        import torch
        method = body.get('method', 'cnn')
        model = _neuralook_models.get(method)
        if model is None:
            return jsonify({'error': f'Model not trained for method: {method}'}), 400
        raw = body.get('eyeData', [])
        screen_w, screen_h, eye_w, eye_h = _neuralook_screen
        eye_size = eye_w * eye_h
        if len(raw) != eye_size * 2:
            return jsonify({'error': f'Expected {eye_size * 2} values, got {len(raw)}'}), 400
        left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
        right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
        inp = torch.cat([left, right], dim=0).unsqueeze(0)
        with torch.no_grad():
            if method == 'cnn_headpose':
                hp = body.get('headPose', [0, 0, 0])
                hp_tensor = torch.tensor([hp], dtype=torch.float32)
                pred = model(inp, hp_tensor)[0]
            else:
                pred = model(inp)[0]
        return jsonify({
            'x': round(pred[0].item() * screen_w, 1),
            'y': round(pred[1].item() * screen_h, 1)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
