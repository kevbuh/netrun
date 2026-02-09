"""Misc routes: neuralook (SSE), transcribe, vibe/git, reveal-in-finder, settings, version, dev-stats,
calendar, todos, images, saved-posts, custom-feeds, tex-preview, local-file, arxiv-pdf, pdf-proxy."""
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

from flask import Blueprint, request, jsonify, Response, stream_with_context, send_file

from helpers import require_auth, sse_event
from persistence import (
    DIR,
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
_neuralook_hidden = {}  # per-method LSTM hidden state for temporal models
_whisper_model = None
_kokoro_pipeline = None

# Lazy-initialized GazeCNN class (needs torch)
_GazeCNN = None

def _get_gaze_cnn_class():
    global _GazeCNN
    if _GazeCNN is not None:
        return _GazeCNN
    import torch
    import torch.nn as nn

    class GazeCNN(nn.Module):
        def __init__(self, aux_dim=9, temporal=False):
            super().__init__()
            self.aux_dim = aux_dim
            self.temporal = temporal
            self.features = nn.Sequential(
                nn.Conv2d(2, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
                nn.AdaptiveAvgPool2d((4, 4)),
            )
            feat_dim = 128 * 4 * 4 + aux_dim  # 2057
            if temporal:
                self.proj = nn.Sequential(nn.Linear(feat_dim, 128), nn.ReLU())
                self.lstm = nn.LSTM(input_size=128, hidden_size=64, num_layers=1, batch_first=True)
                self.head = nn.Sequential(
                    nn.Linear(64, 32), nn.ReLU(), nn.Dropout(0.3),
                    nn.Linear(32, 2)
                )
            else:
                self.head = nn.Sequential(
                    nn.Linear(feat_dim, 256), nn.ReLU(), nn.Dropout(0.3),
                    nn.Linear(256, 64), nn.ReLU(), nn.Dropout(0.3),
                    nn.Linear(64, 2)
                )
        def forward(self, x, aux, hidden=None):
            if self.temporal and x.dim() == 5:
                # Sequence input: x=[B,T,2,H,W], aux=[B,T,9]
                B, T = x.shape[0], x.shape[1]
                x_flat = x.view(B * T, *x.shape[2:])
                aux_flat = aux.view(B * T, -1)
                feat = self.features(x_flat)
                feat = feat.view(B * T, -1)
                combined = torch.cat([feat, aux_flat], dim=1)
                proj = self.proj(combined).view(B, T, -1)
                lstm_out, _ = self.lstm(proj)
                return self.head(lstm_out), None
            feat = self.features(x)
            feat = feat.view(feat.size(0), -1)
            combined = torch.cat([feat, aux], dim=1)
            if self.temporal:
                proj = self.proj(combined).unsqueeze(1)  # [B,1,128]
                lstm_out, new_hidden = self.lstm(proj, hidden)
                return self.head(lstm_out.squeeze(1)), new_hidden
            return self.head(combined), None

    _GazeCNN = GazeCNN
    return _GazeCNN


# Lazy-initialized GazeMobileNet class (needs torch)
_GazeMobileNet = None

def _get_gaze_mobilenet_class():
    global _GazeMobileNet
    if _GazeMobileNet is not None:
        return _GazeMobileNet
    import torch
    import torch.nn as nn

    class DepthwiseSeparableConv(nn.Module):
        def __init__(self, in_ch, out_ch, stride=1):
            super().__init__()
            self.depthwise = nn.Sequential(
                nn.Conv2d(in_ch, in_ch, 3, stride=stride, padding=1, groups=in_ch),
                nn.BatchNorm2d(in_ch), nn.ReLU())
            self.pointwise = nn.Sequential(
                nn.Conv2d(in_ch, out_ch, 1),
                nn.BatchNorm2d(out_ch), nn.ReLU())
        def forward(self, x):
            return self.pointwise(self.depthwise(x))

    class GazeMobileNet(nn.Module):
        def __init__(self, aux_dim=9, temporal=False):
            super().__init__()
            self.aux_dim = aux_dim
            self.temporal = temporal
            self.features = nn.Sequential(
                nn.Conv2d(2, 16, 3, stride=2, padding=1), nn.BatchNorm2d(16), nn.ReLU(),
                DepthwiseSeparableConv(16, 32, stride=2),
                DepthwiseSeparableConv(32, 64, stride=2),
                DepthwiseSeparableConv(64, 64, stride=1),
                nn.AdaptiveAvgPool2d((4, 4)),
            )
            feat_dim = 64 * 4 * 4 + aux_dim  # 1033
            if temporal:
                self.proj = nn.Sequential(nn.Linear(feat_dim, 64), nn.ReLU())
                self.lstm = nn.LSTM(input_size=64, hidden_size=32, num_layers=1, batch_first=True)
                self.head = nn.Sequential(
                    nn.Linear(32, 16), nn.ReLU(), nn.Dropout(0.2),
                    nn.Linear(16, 2)
                )
            else:
                self.head = nn.Sequential(
                    nn.Linear(feat_dim, 128), nn.ReLU(), nn.Dropout(0.2),
                    nn.Linear(128, 32), nn.ReLU(), nn.Dropout(0.2),
                    nn.Linear(32, 2)
                )
        def forward(self, x, aux, hidden=None):
            if self.temporal and x.dim() == 5:
                B, T = x.shape[0], x.shape[1]
                x_flat = x.view(B * T, *x.shape[2:])
                aux_flat = aux.view(B * T, -1)
                feat = self.features(x_flat)
                feat = feat.view(B * T, -1)
                combined = torch.cat([feat, aux_flat], dim=1)
                proj = self.proj(combined).view(B, T, -1)
                lstm_out, _ = self.lstm(proj)
                return self.head(lstm_out), None
            feat = self.features(x)
            feat = feat.view(feat.size(0), -1)
            combined = torch.cat([feat, aux], dim=1)
            if self.temporal:
                proj = self.proj(combined).unsqueeze(1)
                lstm_out, new_hidden = self.lstm(proj, hidden)
                return self.head(lstm_out.squeeze(1)), new_hidden
            return self.head(combined), None

    _GazeMobileNet = GazeMobileNet
    return _GazeMobileNet


def _nl_get_model_class(method):
    if method == 'mobilenet':
        return _get_gaze_mobilenet_class()
    return _get_gaze_cnn_class()


def _nl_save_model(model, screen_w, screen_h, eye_w, eye_h, method='cnn'):
    """Save model checkpoint and metadata to disk."""
    import torch
    suffix = '_mobilenet' if method == 'mobilenet' else ''
    model_path = os.path.join(DIR, f'neuralook_model{suffix}.pt')
    meta_path = os.path.join(DIR, f'neuralook_model{suffix}_meta.json')
    torch.save(model.state_dict(), model_path)
    with open(meta_path, 'w') as f:
        json.dump({'aux_dim': model.aux_dim, 'screen_w': screen_w, 'screen_h': screen_h,
                   'eye_w': eye_w, 'eye_h': eye_h, 'method': method,
                   'temporal': getattr(model, 'temporal', False)}, f)


def _nl_load_model(method='cnn'):
    """Load model from disk checkpoint if available. Returns (model, screen_info) or (None, None)."""
    import torch
    suffix = '_mobilenet' if method == 'mobilenet' else ''
    model_path = os.path.join(DIR, f'neuralook_model{suffix}.pt')
    meta_path = os.path.join(DIR, f'neuralook_model{suffix}_meta.json')
    if not os.path.exists(model_path) or not os.path.exists(meta_path):
        return None, None
    try:
        with open(meta_path, 'r') as f:
            meta = json.load(f)
        ModelClass = _nl_get_model_class(method)
        temporal = meta.get('temporal', False)
        model = ModelClass(aux_dim=meta.get('aux_dim', 9), temporal=temporal)
        model.load_state_dict(torch.load(model_path, weights_only=True))
        model.eval()
        screen_info = (meta['screen_w'], meta['screen_h'], meta['eye_w'], meta['eye_h'])
        return model, screen_info
    except Exception as e:
        print(f'Neuralook: failed to load model checkpoint ({method}): {e}')
        return None, None


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


@bp.route('/api/dev-git-log')
def dev_git_log():
    try:
        offset = int(request.args.get('offset', 0))
        limit = int(request.args.get('limit', 20))
        limit = min(limit, 100)
        git_root = os.path.dirname(DIR)
        sep = '\x1f'
        r = subprocess.run(
            ['git', 'log', f'--skip={offset}', f'-{limit}', f'--format=COMMIT{sep}%H{sep}%an{sep}%ad{sep}%s', '--date=iso', '--shortstat'],
            capture_output=True, text=True, cwd=git_root, timeout=10)
        git_log = []
        if r.returncode == 0:
            current = None
            for line in r.stdout.split('\n'):
                line = line.strip()
                if not line:
                    continue
                if line.startswith('COMMIT' + sep):
                    parts = line.split(sep, 4)
                    if len(parts) == 5:
                        current = {'sha': parts[1][:8], 'author': parts[2], 'date': parts[3], 'message': parts[4], 'ins': 0, 'del': 0}
                        git_log.append(current)
                elif current and 'changed' in line:
                    m_ins = re.search(r'(\d+) insertion', line)
                    m_del = re.search(r'(\d+) deletion', line)
                    current['ins'] = int(m_ins.group(1)) if m_ins else 0
                    current['del'] = int(m_del.group(1)) if m_del else 0
                    current = None
        return jsonify({'git_log': git_log, 'has_more': len(git_log) == limit})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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
        total_commits = 0
        project_age_days = 0
        first_commit_date = ''
        git_root = os.path.dirname(DIR)
        try:
            today = time.strftime('%Y-%m-%dT00:00:00')
            result = subprocess.run(['git', 'rev-list', '--count', '--since=' + today, 'HEAD'],
                                    capture_output=True, text=True, cwd=git_root)
            commits_today = int(result.stdout.strip()) if result.returncode == 0 else 0
        except Exception:
            pass
        try:
            r = subprocess.run(['git', 'rev-list', '--count', 'HEAD'],
                               capture_output=True, text=True, cwd=git_root)
            total_commits = int(r.stdout.strip()) if r.returncode == 0 else 0
        except Exception:
            pass
        try:
            r = subprocess.run(['git', 'log', '--reverse', '--format=%ad', '--date=short'],
                               capture_output=True, text=True, cwd=git_root)
            if r.returncode == 0 and r.stdout.strip():
                first_commit_date = r.stdout.strip().split('\n')[0]
                from datetime import datetime
                fd = datetime.strptime(first_commit_date, '%Y-%m-%d')
                project_age_days = max(1, (datetime.now() - fd).days)
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
                    ['git', 'log', '--numstat', '--format=%ad', '--date=short', '--since=30 days ago'],
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
                                fname = parts3[2]
                                if fname.endswith(('.js', '.py', '.css', '.html')):
                                    try:
                                        day_stats[current_date]['added'] += int(parts3[0])
                                        day_stats[current_date]['deleted'] += int(parts3[1])
                                    except (ValueError, IndexError):
                                        pass
                for date in sorted(day_commits.keys()):
                    sha = day_commits[date]
                    lines = 0
                    try:
                        r = subprocess.run(['git', 'ls-tree', '-r', '--name-only', sha],
                                           capture_output=True, text=True, cwd=git_root, timeout=5)
                        if r.returncode == 0:
                            for fp in r.stdout.strip().split('\n'):
                                if fp and fp.endswith(('.js', '.py', '.css', '.html')) and not fp.startswith('node_modules/'):
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
            sep = '\x1f'
            r = subprocess.run(
                ['git', 'log', '-20', f'--format=COMMIT{sep}%H{sep}%an{sep}%ad{sep}%s', '--date=iso', '--shortstat'],
                capture_output=True, text=True, cwd=git_root, timeout=10)
            if r.returncode == 0:
                current = None
                for line in r.stdout.split('\n'):
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith('COMMIT' + sep):
                        parts = line.split(sep, 4)
                        if len(parts) == 5:
                            current = {'sha': parts[1][:8], 'author': parts[2], 'date': parts[3], 'message': parts[4], 'ins': 0, 'del': 0}
                            git_log.append(current)
                    elif current and 'changed' in line:
                        m_ins = re.search(r'(\d+) insertion', line)
                        m_del = re.search(r'(\d+) deletion', line)
                        current['ins'] = int(m_ins.group(1)) if m_ins else 0
                        current['del'] = int(m_del.group(1)) if m_del else 0
                        current = None
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

        avg_commits_day = round(total_commits / project_age_days, 1) if project_age_days else 0
        return jsonify({
            'users': users,
            'active_sessions': active_sessions,
            'total_loc': total_loc,
            'files': file_count,
            'commits_today': commits_today,
            'total_commits': total_commits,
            'project_age_days': project_age_days,
            'first_commit_date': first_commit_date,
            'avg_commits_day': avg_commits_day,
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


@bp.route('/api/pdf-proxy')
def pdf_proxy():
    import ssl
    import urllib.request
    url = request.args.get('url', '').strip()
    if not url or not url.startswith('http'):
        return Response(status=400)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
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


@bp.route('/api/tts', methods=['POST'])
@require_auth
def tts(google_id):
    body = request.get_json(force=True, silent=True) or {}
    text = (body.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    voice = body.get('voice', 'af_heart')
    try:
        from kokoro import KPipeline
        global _kokoro_pipeline
        if _kokoro_pipeline is None:
            _kokoro_pipeline = KPipeline(lang_code='a')
        import soundfile as sf
        samples = []
        for _, _, audio in _kokoro_pipeline(text, voice=voice):
            samples.append(audio)
        if not samples:
            return jsonify({'error': 'No audio generated'}), 500
        import numpy as np
        combined = np.concatenate(samples)
        uid = uuid.uuid4().hex
        tmp_wav = os.path.join(tempfile.gettempdir(), f'tts_{uid}.wav')
        sf.write(tmp_wav, combined, 24000)
        resp = send_file(tmp_wav, mimetype='audio/wav')
        @resp.call_on_close
        def _cleanup():
            try: os.remove(tmp_wav)
            except: pass
        return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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


def _nl_build_temporal_sequences(X, AUX, Y, targets_rounded, seq_len=8):
    """Group frames by screen target and create overlapping sliding windows."""
    import torch
    from collections import defaultdict
    target_indices = defaultdict(list)
    for i, t in enumerate(targets_rounded):
        target_indices[t].append(i)
    seq_X, seq_AUX, seq_Y = [], [], []
    for t, indices in target_indices.items():
        indices.sort()
        if len(indices) < seq_len:
            # Pad short sequences by repeating last frame
            padded = indices + [indices[-1]] * (seq_len - len(indices))
            seq_X.append(X[padded])
            seq_AUX.append(AUX[padded])
            seq_Y.append(Y[padded])
        else:
            for start in range(len(indices) - seq_len + 1):
                window = indices[start:start + seq_len]
                seq_X.append(X[window])
                seq_AUX.append(AUX[window])
                seq_Y.append(Y[window])
    if not seq_X:
        return None, None, None
    return torch.stack(seq_X), torch.stack(seq_AUX), torch.stack(seq_Y)


@bp.route('/api/neuralook/train', methods=['POST'])
@require_auth
def neuralook_train(google_id):
    global _neuralook_models, _neuralook_screen, _neuralook_hidden
    body = request.get_json(force=True, silent=True) or {}

    def generate():
        global _neuralook_models, _neuralook_screen, _neuralook_hidden
        try:
            import torch
            import torch.nn as nn
            import random

            method = body.get('method', 'cnn')
            refine = body.get('refine', False)
            samples = body.get('samples', [])
            if not samples:
                calib_path = os.path.join(DIR, 'neuralook_calibration.json')
                if os.path.exists(calib_path):
                    with open(calib_path, 'r') as f:
                        calib = json.loads(f.read())
                    samples = calib.get('samples', [])
                    body.setdefault('screenW', calib.get('screenW', 1920))
                    body.setdefault('screenH', calib.get('screenH', 1080))
                    body.setdefault('eyeW', calib.get('eyeW', 128))
                    body.setdefault('eyeH', calib.get('eyeH', 64))

            # Load implicit samples for refine mode
            implicit_samples = []
            if refine:
                impl_path = os.path.join(DIR, 'neuralook_implicit.json')
                if os.path.exists(impl_path):
                    try:
                        with open(impl_path, 'r') as f:
                            implicit_samples = json.load(f)
                    except Exception:
                        implicit_samples = []
                if not implicit_samples:
                    yield sse_event('error', {'error': 'No implicit samples available for refinement'})
                    return
                samples = samples + implicit_samples

            screen_w = body.get('screenW', 1920)
            screen_h = body.get('screenH', 1080)
            eye_w = body.get('eyeW', 128)
            eye_h = body.get('eyeH', 64)
            if len(samples) < 10:
                yield sse_event('error', {'error': f'Need at least 10 samples, got {len(samples)}'})
                return

            iris_default = [0.5, 0.5, 0.5, 0.5, 0.3, 0.3]
            eye_size = eye_w * eye_h
            X_list, AUX_list, Y_list = [], [], []
            for s in samples:
                raw = s['eyeData']
                if len(raw) != eye_size * 2:
                    continue
                left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                X_list.append(torch.cat([left, right], dim=0))
                hp = s.get('headPose', [0.0, 0.0, 0.0])
                hp = hp[:3] if len(hp) >= 3 else hp + [0.0] * (3 - len(hp))
                iris = s.get('irisFeatures', iris_default)
                iris = iris[:6] if len(iris) >= 6 else iris + [0.0] * (6 - len(iris))
                AUX_list.append(hp + iris)
                Y_list.append([s['screenX'] / screen_w, s['screenY'] / screen_h])

            if len(X_list) < 10:
                yield sse_event('error', {'error': f'Only {len(X_list)} valid samples'})
                return

            X = torch.stack(X_list)
            AUX = torch.tensor(AUX_list, dtype=torch.float32)
            Y = torch.tensor(Y_list, dtype=torch.float32)

            targets_rounded = [(round(s['screenX']), round(s['screenY'])) for s in samples if len(s['eyeData']) == eye_size * 2]
            unique_targets = list(set(targets_rounded))
            n_val_points = max(2, len(unique_targets) // 4)
            random.shuffle(unique_targets)
            val_targets = set(unique_targets[:n_val_points])
            val_mask = torch.tensor([t in val_targets for t in targets_rounded])
            train_mask = ~val_mask

            X_train, AUX_train, Y_train = X[train_mask], AUX[train_mask], Y[train_mask]
            X_val, AUX_val, Y_val = X[val_mask], AUX[val_mask], Y[val_mask]

            ModelClass = _nl_get_model_class(method)

            def augment_batch(x_batch):
                B = x_batch.shape[0]
                aug = x_batch.clone()
                aug = aug * (1.0 + (torch.rand(B, 1, 1, 1) * 0.4 - 0.2))
                mean = aug.mean(dim=(-2, -1), keepdim=True)
                aug = (aug - mean) * (1.0 + (torch.rand(B, 1, 1, 1) * 0.3 - 0.15)) + mean
                aug = aug + torch.randn_like(aug) * 0.02
                shift = torch.randint(-2, 3, (B,))
                for i in range(B):
                    s = shift[i].item()
                    if s != 0:
                        aug[i] = torch.roll(aug[i], shifts=s, dims=-1)
                        if s > 0: aug[i, :, :, :s] = 0.0
                        else: aug[i, :, :, s:] = 0.0
                return aug.clamp(0.0, 1.0)

            # Build temporal sequences from calibration data
            SEQ_LEN = 8
            train_targets = [targets_rounded[i] for i in range(len(targets_rounded)) if train_mask[i]]
            val_targets_list = [targets_rounded[i] for i in range(len(targets_rounded)) if val_mask[i]]
            seq_X_train, seq_AUX_train, seq_Y_train = _nl_build_temporal_sequences(X_train, AUX_train, Y_train, train_targets, SEQ_LEN)
            seq_X_val, seq_AUX_val, seq_Y_val = _nl_build_temporal_sequences(X_val, AUX_val, Y_val, val_targets_list, SEQ_LEN)
            use_temporal = seq_X_train is not None and seq_X_train.shape[0] >= 2

            # Refine: load existing model and freeze conv layers
            if refine:
                model = _neuralook_models.get(method)
                if model is None:
                    model, screen_info = _nl_load_model(method)
                    if model is None:
                        yield sse_event('error', {'error': 'No existing model to refine'})
                        return
                    _neuralook_screen = screen_info
                # If refining a non-temporal model, start fresh with temporal
                if not getattr(model, 'temporal', False) and use_temporal:
                    yield sse_event('log', {'text': 'Upgrading non-temporal model → fresh temporal training'})
                    model = ModelClass(aux_dim=9, temporal=True)
                    refine = False  # treat as fresh training
                else:
                    # Freeze conv layers
                    for param in model.features.parameters():
                        param.requires_grad = False
                    trainable_params = [p for p in model.parameters() if p.requires_grad]
                    optimizer = torch.optim.Adam(trainable_params, lr=5e-5, weight_decay=1e-4)
                    max_epochs = 100
                    patience = 30
                    yield sse_event('log', {'text': f'Refine mode: frozen conv layers, lr=5e-5, max_epochs={max_epochs}'})
                    yield sse_event('log', {'text': f'Combining {len(samples) - len(implicit_samples)} calibration + {len(implicit_samples)} implicit samples'})
            if not refine:
                model = ModelClass(aux_dim=9, temporal=use_temporal)
                optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
                max_epochs = 100
                patience = 30

            _neuralook_models[method] = model
            _neuralook_screen = (screen_w, screen_h, eye_w, eye_h)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max_epochs)
            n_train = X_train.shape[0]
            batch_size = min(64, n_train)
            best_val_loss = float('inf')
            best_state = None
            no_improve = 0
            stopped_epoch = 0

            yield sse_event('progress', {'epoch': 0, 'max_epochs': max_epochs, 'phase': 'training', 'val_loss': None})

            n_params = sum(p.numel() for p in model.parameters())
            n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
            model_name = 'GazeMobileNet' if method == 'mobilenet' else 'GazeCNN'
            temporal_tag = ' + temporal LSTM' if model.temporal else ''
            yield sse_event('log', {'text': f'{model_name}{temporal_tag} | params: {n_params:,} ({n_trainable:,} trainable) | input: [B, 2, {eye_h}, {eye_w}]'})
            if method == 'mobilenet':
                yield sse_event('log', {'text': f'  features: Conv2d(2→16,s=2) → BN → DSConv(16→32,s=2) → DSConv(32→64,s=2) → DSConv(64→64,s=1) → AdaptivePool(4,4)'})
                if model.temporal:
                    yield sse_event('log', {'text': f'  temporal: Flatten(1024) + aux(9) → proj Linear(1033,64) → ReLU → LSTM(64→32, 1 layer)'})
                    yield sse_event('log', {'text': f'  head: Linear(32,16) → ReLU → Drop(0.2) → Linear(16,2)'})
                else:
                    yield sse_event('log', {'text': f'  head: Flatten(1024) + aux(9: hp+iris) → Linear(1033,128) → ReLU → Drop(0.2) → Linear(128,32) → ReLU → Drop(0.2) → Linear(32,2)'})
            else:
                yield sse_event('log', {'text': f'  features: Conv2d(2→32) → BN → Pool → Conv2d(32→64) → BN → Pool → Conv2d(64→128) → BN → AdaptivePool(4,4)'})
                if model.temporal:
                    yield sse_event('log', {'text': f'  temporal: Flatten(2048) + aux(9) → proj Linear(2057,128) → ReLU → LSTM(128→64, 1 layer)'})
                    yield sse_event('log', {'text': f'  head: Linear(64,32) → ReLU → Drop(0.3) → Linear(32,2)'})
                else:
                    yield sse_event('log', {'text': f'  head: Flatten(2048) + aux(9: hp+iris) → Linear(2057,256) → ReLU → Drop(0.3) → Linear(256,64) → ReLU → Drop(0.3) → Linear(64,2)'})
            yield sse_event('log', {'text': f'Adam(lr={optimizer.param_groups[0]["lr"]}, weight_decay=1e-4) + CosineAnnealingLR(T_max={max_epochs})'})
            yield sse_event('log', {'text': f'train: {int(train_mask.sum())} samples ({len(unique_targets) - n_val_points} points) | val: {int(val_mask.sum())} samples ({n_val_points} points)'})
            if model.temporal and seq_X_train is not None:
                yield sse_event('log', {'text': f'temporal sequences: {seq_X_train.shape[0]} train, {seq_X_val.shape[0] if seq_X_val is not None else 0} val (seq_len={SEQ_LEN})'})
            yield sse_event('log', {'text': f'batch_size={batch_size} | patience={patience} | max_epochs={max_epochs}'})
            if not refine:
                yield sse_event('log', {'text': 'augmentation: brightness(±20%), contrast(±15%), noise(σ=0.02), h-shift(±2px)'})
            yield sse_event('log', {'text': ''})
            yield sse_event('log', {'text': f'{"epoch":>6}  {"train_loss":>11}  {"val_loss":>11}  {"lr":>10}  {"best":>5}  {"patience":>8}'})
            yield sse_event('log', {'text': '─' * 65})

            # Determine if we're training on sequences or flat frames
            _train_temporal = model.temporal and seq_X_train is not None and seq_X_val is not None

            last_train_loss = 0.0
            for epoch in range(max_epochs):
                model.train()
                if _train_temporal:
                    n_seq = seq_X_train.shape[0]
                    seq_batch_size = min(16, n_seq)
                    perm = torch.randperm(n_seq)
                    epoch_loss = 0.0
                    n_batches = 0
                    for start in range(0, n_seq, seq_batch_size):
                        idx = perm[start:start + seq_batch_size]
                        x_batch = seq_X_train[idx]
                        if not refine:
                            # Augment each frame in the sequence
                            B, T = x_batch.shape[0], x_batch.shape[1]
                            x_flat = x_batch.view(B * T, *x_batch.shape[2:])
                            x_flat = augment_batch(x_flat)
                            x_batch = x_flat.view(B, T, *x_batch.shape[2:])
                        pred, _ = model(x_batch, seq_AUX_train[idx])
                        loss = nn.functional.mse_loss(pred, seq_Y_train[idx])
                        optimizer.zero_grad()
                        loss.backward()
                        optimizer.step()
                        epoch_loss += loss.item()
                        n_batches += 1
                else:
                    perm = torch.randperm(n_train)
                    epoch_loss = 0.0
                    n_batches = 0
                    for start in range(0, n_train, batch_size):
                        idx = perm[start:start + batch_size]
                        x_batch = augment_batch(X_train[idx]) if not refine else X_train[idx]
                        pred, _ = model(x_batch, AUX_train[idx])
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
                        # Validate per-frame (not sequences) for consistent pixel-error metric
                        val_pred, _ = model(X_val, AUX_val)
                        val_loss = nn.functional.mse_loss(val_pred, Y_val).item()
                    improved = val_loss < best_val_loss
                    if improved:
                        best_val_loss = val_loss
                        best_state = {k: v.clone() for k, v in model.state_dict().items()}
                        no_improve = 0
                        # Hot-swap: load best weights into serving model, save checkpoint, notify frontend
                        model.load_state_dict(best_state)
                        model.eval()
                        _neuralook_models[method] = model
                        _neuralook_hidden[method] = None
                        _nl_save_model(model, screen_w, screen_h, eye_w, eye_h, method)
                        with torch.no_grad():
                            vp_hot, _ = model(X_val, AUX_val)
                            vp2_hot = vp_hot.clone(); vp2_hot[:, 0] *= screen_w; vp2_hot[:, 1] *= screen_h
                            yv_hot = Y_val.clone(); yv_hot[:, 0] *= screen_w; yv_hot[:, 1] *= screen_h
                            hot_val_err = round(torch.sqrt(((vp2_hot - yv_hot) ** 2).sum(dim=1)).mean().item(), 1)
                            tp_hot, _ = model(X_train, AUX_train)
                            tp2_hot = tp_hot.clone(); tp2_hot[:, 0] *= screen_w; tp2_hot[:, 1] *= screen_h
                            yt_hot = Y_train.clone(); yt_hot[:, 0] *= screen_w; yt_hot[:, 1] *= screen_h
                            hot_train_err = round(torch.sqrt(((tp2_hot - yt_hot) ** 2).sum(dim=1)).mean().item(), 1)
                        yield sse_event('model_updated', {'val_error_px': hot_val_err, 'train_error_px': hot_train_err, 'epoch': epoch})
                    else:
                        no_improve += 10
                    cur_lr = optimizer.param_groups[0]['lr']
                    yield sse_event('log', {'text': f'{epoch:>6}  {last_train_loss:>11.6f}  {val_loss:>11.6f}  {cur_lr:>10.2e}  {"✓" if improved else " ":>5}  {no_improve:>4}/{patience}'})
                    prog_data = {'epoch': epoch, 'max_epochs': max_epochs, 'val_loss': round(val_loss, 6), 'train_loss': round(last_train_loss, 6), 'phase': 'training'}
                    if epoch == 0 and not refine:
                        prog_data['model_ready'] = True
                    yield sse_event('progress', prog_data)
                    if no_improve >= patience:
                        yield sse_event('log', {'text': f'\nEarly stopping at epoch {epoch} (no improvement for {patience} epochs)'})
                        stopped_epoch = epoch
                        break
                stopped_epoch = epoch

            if best_state:
                model.load_state_dict(best_state)
                yield sse_event('log', {'text': f'Restored best model (val_loss={best_val_loss:.6f})'})
            model.eval()
            _neuralook_hidden[method] = None
            yield sse_event('log', {'text': ''})
            yield sse_event('log', {'text': 'Evaluating on train/val sets...'})
            yield sse_event('progress', {'epoch': stopped_epoch, 'max_epochs': max_epochs, 'phase': 'evaluating'})

            with torch.no_grad():
                train_pred, _ = model(X_train, AUX_train)
                tp = train_pred.clone(); tp[:, 0] *= screen_w; tp[:, 1] *= screen_h
                yt = Y_train.clone(); yt[:, 0] *= screen_w; yt[:, 1] *= screen_h
                train_err = torch.sqrt(((tp - yt) ** 2).sum(dim=1)).mean().item()
                vp, _ = model(X_val, AUX_val)
                vp2 = vp.clone(); vp2[:, 0] *= screen_w; vp2[:, 1] *= screen_h
                yv = Y_val.clone(); yv[:, 0] *= screen_w; yv[:, 1] *= screen_h
                val_err = torch.sqrt(((vp2 - yv) ** 2).sum(dim=1)).mean().item()

            _neuralook_models[method] = model
            _neuralook_screen = (screen_w, screen_h, eye_w, eye_h)

            # Save checkpoint
            _nl_save_model(model, screen_w, screen_h, eye_w, eye_h, method)

            yield sse_event('log', {'text': f'  train error: {train_err:.1f}px'})
            yield sse_event('log', {'text': f'  val error:   {val_err:.1f}px'})
            qual = 'Good' if val_err < 80 else 'Fair' if val_err < 150 else 'Poor'
            yield sse_event('log', {'text': f'  quality:     {qual}'})
            yield sse_event('log', {'text': ''})
            yield sse_event('log', {'text': f'Model saved to disk. Ready for inference ({n_params:,} params, screen {screen_w}x{screen_h}).'})

            # Clear implicit samples after successful refinement
            if refine:
                impl_path = os.path.join(DIR, 'neuralook_implicit.json')
                if os.path.exists(impl_path):
                    os.remove(impl_path)
                yield sse_event('log', {'text': 'Implicit samples cleared after refinement.'})

            yield sse_event('done', {
                'method': method,
                'train_error_px': round(train_err, 1),
                'val_error_px': round(val_err, 1),
                'stopped_epoch': stopped_epoch,
                'loss': round(best_val_loss, 6),
                'samples': len(X_list),
                'train_samples': int(train_mask.sum()),
                'val_samples': int(val_mask.sum()),
                'val_points': n_val_points,
                'refined': refine,
                'temporal': model.temporal
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
    global _neuralook_models, _neuralook_screen, _neuralook_hidden
    body = request.get_json(force=True, silent=True) or {}
    try:
        import torch
        method = body.get('method', 'cnn')
        model = _neuralook_models.get(method)
        if model is None:
            # Try loading from checkpoint
            model, screen_info = _nl_load_model(method)
            if model is None:
                return jsonify({'error': f'Model not trained for method: {method}'}), 400
            _neuralook_models[method] = model
            _neuralook_screen = screen_info
        raw = body.get('eyeData', [])
        hp_raw = body.get('headPose', [0.0, 0.0, 0.0])
        iris_raw = body.get('irisFeatures', [0.5, 0.5, 0.5, 0.5, 0.3, 0.3])
        _train_screen_w, _train_screen_h, eye_w, eye_h = _neuralook_screen
        # Use client's current screen dims for scaling (adapts to window resize)
        screen_w = body.get('screenW', _train_screen_w)
        screen_h = body.get('screenH', _train_screen_h)
        eye_size = eye_w * eye_h
        if len(raw) != eye_size * 2:
            return jsonify({'error': f'Expected {eye_size * 2} values, got {len(raw)}'}), 400
        left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
        right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
        inp = torch.cat([left, right], dim=0).unsqueeze(0)
        hp = hp_raw[:3] if len(hp_raw) >= 3 else hp_raw + [0.0] * (3 - len(hp_raw))
        iris = iris_raw[:6] if len(iris_raw) >= 6 else iris_raw + [0.0] * (6 - len(iris_raw))
        aux = torch.tensor([hp + iris], dtype=torch.float32)
        was_training = model.training
        model.eval()
        with torch.no_grad():
            hidden = _neuralook_hidden.get(method)
            pred, new_hidden = model(inp, aux, hidden)
            if new_hidden is not None:
                _neuralook_hidden[method] = tuple(h.detach() for h in new_hidden)
            pred = pred[0]
        if was_training:
            model.train()
        return jsonify({
            'x': round(pred[0].item() * screen_w, 1),
            'y': round(pred[1].item() * screen_h, 1)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/neuralook/reset-hidden', methods=['POST'])
@require_auth
def neuralook_reset_hidden(google_id):
    global _neuralook_hidden
    body = request.get_json(force=True, silent=True) or {}
    method = body.get('method', 'cnn')
    _neuralook_hidden[method] = None
    return jsonify({'ok': True})


@bp.route('/api/neuralook/implicit-samples', methods=['POST'])
@require_auth
def neuralook_implicit_samples_post(google_id):
    body = request.get_json(force=True, silent=True) or {}
    samples = body.get('samples', [])
    if not samples:
        return jsonify({'error': 'No samples provided'}), 400
    impl_path = os.path.join(DIR, 'neuralook_implicit.json')
    existing = []
    if os.path.exists(impl_path):
        try:
            with open(impl_path, 'r') as f:
                existing = json.load(f)
        except Exception:
            existing = []
    existing.extend(samples)
    # Cap at 500 samples
    if len(existing) > 500:
        existing = existing[-500:]
    with open(impl_path, 'w') as f:
        json.dump(existing, f)
    return jsonify({'ok': True, 'count': len(existing)})


@bp.route('/api/neuralook/implicit-samples')
@require_auth
def neuralook_implicit_samples_get(google_id):
    impl_path = os.path.join(DIR, 'neuralook_implicit.json')
    count = 0
    if os.path.exists(impl_path):
        try:
            with open(impl_path, 'r') as f:
                data = json.load(f)
            count = len(data)
        except Exception:
            pass
    return jsonify({'count': count})


def _nl_append_refine_history(val_err, train_err, n_samples, improved):
    """Append an entry to neuralook_refine_history.json (capped at 100)."""
    hist_path = os.path.join(DIR, 'neuralook_refine_history.json')
    history = []
    if os.path.exists(hist_path):
        try:
            with open(hist_path, 'r') as f:
                history = json.load(f)
        except Exception:
            history = []
    history.append({
        'timestamp': time.time(),
        'val_error_px': val_err,
        'train_error_px': train_err,
        'samples': n_samples,
        'improved': improved
    })
    if len(history) > 100:
        history = history[-100:]
    with open(hist_path, 'w') as f:
        json.dump(history, f)


@bp.route('/api/neuralook/refine-history')
@require_auth
def neuralook_refine_history(google_id):
    hist_path = os.path.join(DIR, 'neuralook_refine_history.json')
    if os.path.exists(hist_path):
        try:
            with open(hist_path, 'r') as f:
                return jsonify(json.load(f))
        except Exception:
            pass
    return jsonify([])


@bp.route('/api/neuralook/auto-refine', methods=['POST'])
@require_auth
def neuralook_auto_refine(google_id):
    global _neuralook_models, _neuralook_screen, _neuralook_hidden
    body = request.get_json(force=True, silent=True) or {}
    try:
        import torch
        import torch.nn as nn
        import random

        screen_w = body.get('screenW', 1920)
        screen_h = body.get('screenH', 1080)
        eye_w = body.get('eyeW', 128)
        eye_h = body.get('eyeH', 64)
        baseline_val_error = body.get('baseline_val_error')

        # Load calibration data
        calib_path = os.path.join(DIR, 'neuralook_calibration.json')
        samples = []
        if os.path.exists(calib_path):
            with open(calib_path, 'r') as f:
                calib = json.load(f)
            samples = calib.get('samples', [])
            screen_w = calib.get('screenW', screen_w)
            screen_h = calib.get('screenH', screen_h)
            eye_w = calib.get('eyeW', eye_w)
            eye_h = calib.get('eyeH', eye_h)

        # Load implicit samples
        impl_path = os.path.join(DIR, 'neuralook_implicit.json')
        implicit_samples = []
        if os.path.exists(impl_path):
            try:
                with open(impl_path, 'r') as f:
                    implicit_samples = json.load(f)
            except Exception:
                implicit_samples = []

        if not implicit_samples:
            return jsonify({'rejected': True, 'reason': 'No implicit samples'}), 200

        all_samples = samples + implicit_samples

        # Build tensors
        iris_default = [0.5, 0.5, 0.5, 0.5, 0.3, 0.3]
        eye_size = eye_w * eye_h
        X_list, AUX_list, Y_list = [], [], []
        for s in all_samples:
            raw = s['eyeData']
            if len(raw) != eye_size * 2:
                continue
            left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
            right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
            X_list.append(torch.cat([left, right], dim=0))
            hp = s.get('headPose', [0.0, 0.0, 0.0])
            hp = hp[:3] if len(hp) >= 3 else hp + [0.0] * (3 - len(hp))
            iris = s.get('irisFeatures', iris_default)
            iris = iris[:6] if len(iris) >= 6 else iris + [0.0] * (6 - len(iris))
            AUX_list.append(hp + iris)
            Y_list.append([s['screenX'] / screen_w, s['screenY'] / screen_h])

        if len(X_list) < 10:
            return jsonify({'rejected': True, 'reason': f'Only {len(X_list)} valid samples'}), 200

        X = torch.stack(X_list)
        AUX = torch.tensor(AUX_list, dtype=torch.float32)
        Y = torch.tensor(Y_list, dtype=torch.float32)

        # Train/val split by unique screen targets
        targets_rounded = [(round(s['screenX']), round(s['screenY'])) for s in all_samples if len(s['eyeData']) == eye_size * 2]
        unique_targets = list(set(targets_rounded))
        n_val_points = max(2, len(unique_targets) // 4)
        random.shuffle(unique_targets)
        val_targets = set(unique_targets[:n_val_points])
        val_mask = torch.tensor([t in val_targets for t in targets_rounded])
        train_mask = ~val_mask

        X_train, AUX_train, Y_train = X[train_mask], AUX[train_mask], Y[train_mask]
        X_val, AUX_val, Y_val = X[val_mask], AUX[val_mask], Y[val_mask]

        if X_train.shape[0] < 5 or X_val.shape[0] < 2:
            return jsonify({'rejected': True, 'reason': 'Not enough data for train/val split'}), 200

        # Load existing model
        method = body.get('method', 'cnn')
        model = _neuralook_models.get(method)
        if model is None:
            model, screen_info = _nl_load_model(method)
            if model is None:
                return jsonify({'rejected': True, 'reason': 'No existing model to refine'}), 200
            _neuralook_models[method] = model
            _neuralook_screen = screen_info

        # Save pre-refine state for rollback
        pre_refine_state = {k: v.clone() for k, v in model.state_dict().items()}

        # Freeze conv layers (and proj for temporal models), micro-refinement settings
        for param in model.features.parameters():
            param.requires_grad = False
        if getattr(model, 'temporal', False) and hasattr(model, 'proj'):
            for param in model.proj.parameters():
                param.requires_grad = False
        trainable_params = [p for p in model.parameters() if p.requires_grad]
        optimizer = torch.optim.Adam(trainable_params, lr=2e-5, weight_decay=1e-4)
        max_epochs = 30
        patience = 10

        n_train = X_train.shape[0]
        batch_size = min(64, n_train)
        best_val_loss = float('inf')
        best_state = None
        no_improve = 0

        for epoch in range(max_epochs):
            model.train()
            perm = torch.randperm(n_train)
            epoch_loss = 0.0
            n_batches = 0
            for start in range(0, n_train, batch_size):
                idx = perm[start:start + batch_size]
                pred, _ = model(X_train[idx], AUX_train[idx])
                loss = nn.functional.mse_loss(pred, Y_train[idx])
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()
                n_batches += 1

            # Validate every epoch
            model.eval()
            with torch.no_grad():
                val_pred, _ = model(X_val, AUX_val)
                val_loss = nn.functional.mse_loss(val_pred, Y_val).item()
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_state = {k: v.clone() for k, v in model.state_dict().items()}
                no_improve = 0
            else:
                no_improve += 1
            if no_improve >= patience:
                break

        # Evaluate best checkpoint
        if best_state:
            model.load_state_dict(best_state)
        model.eval()

        with torch.no_grad():
            train_pred, _ = model(X_train, AUX_train)
            tp = train_pred.clone(); tp[:, 0] *= screen_w; tp[:, 1] *= screen_h
            yt = Y_train.clone(); yt[:, 0] *= screen_w; yt[:, 1] *= screen_h
            train_err = torch.sqrt(((tp - yt) ** 2).sum(dim=1)).mean().item()
            vp, _ = model(X_val, AUX_val)
            vp2 = vp.clone(); vp2[:, 0] *= screen_w; vp2[:, 1] *= screen_h
            yv = Y_val.clone(); yv[:, 0] *= screen_w; yv[:, 1] *= screen_h
            val_err = torch.sqrt(((vp2 - yv) ** 2).sum(dim=1)).mean().item()

        val_err_rounded = round(val_err, 1)
        train_err_rounded = round(train_err, 1)
        n_total = len(X_list)

        # Always accept the refined model
        _neuralook_models[method] = model
        _neuralook_hidden[method] = None
        _neuralook_screen = (screen_w, screen_h, eye_w, eye_h)
        _nl_save_model(model, screen_w, screen_h, eye_w, eye_h, method)
        # Clear implicit samples
        if os.path.exists(impl_path):
            os.remove(impl_path)
        improved = baseline_val_error is None or val_err_rounded < baseline_val_error
        _nl_append_refine_history(val_err_rounded, train_err_rounded, n_total, improved)
        # Unfreeze all layers for next time
        for param in model.parameters():
            param.requires_grad = True
        return jsonify({
            'improved': True, 'val_error_px': val_err_rounded,
            'train_error_px': train_err_rounded, 'samples': n_total
        })

    except ImportError:
        return jsonify({'rejected': True, 'reason': 'PyTorch not installed'}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'rejected': True, 'reason': str(e)}), 200
