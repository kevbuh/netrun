"""Development and utility routes: settings, version, dev stats, function registry, validation,
calendar, images, saved content, custom feeds, file proxies, TeX preview."""
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid

from flask import Blueprint, request, jsonify, Response, send_file

from logger import logger
from helpers import require_auth
from db import DIR
from cache import read_saved_content, write_saved_content
from users import (
    get_user_calendar, create_calendar_event, update_calendar_event, delete_calendar_event,
    get_all_user_data, set_user_data,
)
from vault_helpers import _get_user_vault_path, _vibe_run_git

bp = Blueprint('dev', __name__)

UPLOADS_DIR = os.path.join(DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)


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
        from db import _get_db
        conn = _get_db()
        users = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        active_sessions = conn.execute('SELECT COUNT(*) FROM sessions WHERE expires > ?', (time.time(),)).fetchone()[0]
        conn.close()
        total_loc = 0
        core_loc = 0
        test_loc = 0
        file_count = 0
        for root, dirs, files in os.walk(DIR):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', '__pycache__', 'experiments', 'uploads')]
            for f in files:
                if f.endswith(('.js', '.py', '.css', '.html')):
                    try:
                        with open(os.path.join(root, f), 'r', errors='ignore') as fh:
                            lines = sum(1 for _ in fh)
                        total_loc += lines
                        file_count += 1
                        rel = os.path.relpath(os.path.join(root, f), DIR)
                        if rel.startswith('tests') or '.test.' in f or '.spec.' in f or f.startswith('test_'):
                            test_loc += lines
                        else:
                            core_loc += lines
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
            from users import get_usage_history
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
            'core_loc': core_loc,
            'test_loc': test_loc,
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


@bp.route('/api/function-registry')
@require_auth
def function_registry(google_id):
    """Run function registry analysis and return results"""
    try:
        import json
        # Run the Node.js script
        result = subprocess.run(
            ['node', 'scripts/function-registry.js'],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(DIR),
            timeout=30
        )

        if result.returncode != 0:
            return jsonify({'error': f'Script failed: {result.stderr}'}), 500

        # Read the generated JSON report
        json_path = os.path.join(os.path.dirname(DIR), 'coverage', 'function-registry.json')
        if not os.path.exists(json_path):
            return jsonify({'error': 'Report file not found'}), 500

        with open(json_path, 'r') as f:
            data = json.load(f)

        return jsonify(data)
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Analysis timed out'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/validate-feeds')
@require_auth
def validate_feeds(google_id):
    """
    Run feed catalog validation script and return results.

    Returns:
        {
            "status": "ok" | "error",
            "jsCatalogSize": int,
            "pyCatalogSize": int,
            "errorCount": int,
            "errors": [
                {
                    "type": "MISSING_IN_PY" | "MISSING_IN_JS" | "URL_MISMATCH" | "SPECIAL_MISMATCH",
                    "key": str,
                    "js": {...} | null,
                    "py": {...} | null
                }
            ]
        }
    """
    try:
        import json
        # Run validate-feeds.js script with --json flag
        script_path = os.path.join(os.path.dirname(DIR), 'scripts', 'validate-feeds.js')
        result = subprocess.run(
            ['node', script_path, '--json'],
            capture_output=True,
            text=True,
            timeout=10
        )

        # Parse JSON output (script outputs to stdout even on error)
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            return jsonify({
                'status': 'error',
                'message': 'Failed to parse validation output',
                'stderr': result.stderr
            }), 500

        return jsonify(data)
    except subprocess.TimeoutExpired:
        return jsonify({'status': 'error', 'message': 'Validation timed out'}), 500
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@bp.route('/api/validate-load-order')
@require_auth
def validate_load_order(google_id):
    """
    Run load order validation and return results.

    Returns:
        {
            "status": "ok",
            "scriptCount": int,
            "scriptOrder": [...],
            "forwardRefs": [...],
            "warnings": [...],
            "infos": [...],
            "cycles": [...]
        }
    """
    try:
        import json
        # Run function-registry.js with --check-load-order and --json flags
        script_path = os.path.join(os.path.dirname(DIR), 'scripts', 'function-registry.js')
        result = subprocess.run(
            ['node', script_path, '--check-load-order', '--json'],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            return jsonify({
                'status': 'error',
                'message': f'Script failed: {result.stderr}'
            }), 500

        # Parse JSON output
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            return jsonify({
                'status': 'error',
                'message': 'Failed to parse load order output',
                'stderr': result.stderr
            }), 500

        return jsonify(data)
    except subprocess.TimeoutExpired:
        return jsonify({'status': 'error', 'message': 'Analysis timed out'}), 500
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@bp.route('/api/dependency-graph')
@require_auth
def dependency_graph(google_id):
    """
    Generate function-level dependency graph data for D3.js visualization.

    Query params:
        ?level=file (default) - File-level dependencies
        ?level=function - Function-level dependencies

    Returns:
        {
            "status": "ok",
            "level": "file" | "function",
            "nodes": [...],
            "edges": [...]
        }
    """
    try:
        level = request.args.get('level', 'file')

        if level == 'function':
            return _build_function_level_graph()
        else:
            return _build_file_level_graph()

    except subprocess.TimeoutExpired:
        return jsonify({'status': 'error', 'message': 'Analysis timed out'}), 500
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


def _build_function_level_graph():
    """Build function-level dependency graph"""
    import json

    # Run function registry analysis
    script_path = os.path.join(os.path.dirname(DIR), 'scripts', 'function-registry.js')
    result = subprocess.run(
        ['node', script_path],
        capture_output=True,
        text=True,
        timeout=30
    )

    if result.returncode != 0:
        return jsonify({'status': 'error', 'message': f'Script failed: {result.stderr}'}), 500

    # Read the generated JSON report
    json_path = os.path.join(os.path.dirname(DIR), 'coverage', 'function-registry.json')
    if not os.path.exists(json_path):
        return jsonify({'status': 'error', 'message': 'Report file not found'}), 500

    with open(json_path, 'r') as f:
        data = json.load(f)

    # Build function nodes
    nodes = []
    functions = data.get('functions', {})

    for func_name, func_data in functions.items():
        defs = func_data.get('definitions', [])
        call_count = func_data.get('callCount', 0)

        # Skip if no definitions
        if not defs:
            continue

        # Use first definition for metadata
        primary_def = defs[0]
        file_name = primary_def.get('file', '')
        line_num = primary_def.get('line', 0)

        nodes.append({
            'id': func_name,
            'file': file_name,
            'line': line_num,
            'callCount': call_count,
            'type': primary_def.get('type', 'function'),
            'isGlobal': primary_def.get('isGlobal', False),
            'definitionCount': len(defs)
        })

    # Build function edges (who calls whom)
    edges = []
    edge_map = {}  # Track (caller, callee) -> count

    for func_name, func_data in functions.items():
        call_sites = func_data.get('callSites', [])

        for site in call_sites:
            caller_file = site.get('file')
            caller_line = site.get('line')

            # Find which function contains this call site
            caller_func = _find_function_at_line(functions, caller_file, caller_line)

            if caller_func and caller_func != func_name:
                key = (caller_func, func_name)
                if key not in edge_map:
                    edge_map[key] = 0
                edge_map[key] += 1

    # Convert edge_map to array
    for (source, target), count in edge_map.items():
        edges.append({
            'source': source,
            'target': target,
            'calls': count
        })

    return jsonify({
        'status': 'ok',
        'level': 'function',
        'nodes': nodes,
        'edges': edges
    })


def _find_function_at_line(functions, file_name, line_num):
    """Find which function contains a given line number"""
    # Simple heuristic: find function in same file with line <= target
    candidates = []

    for func_name, func_data in functions.items():
        for defn in func_data.get('definitions', []):
            if defn.get('file') == file_name:
                func_line = defn.get('line', 0)
                if func_line <= line_num:
                    candidates.append((func_name, func_line, line_num - func_line))

    # Return function with smallest distance
    if candidates:
        candidates.sort(key=lambda x: x[2])
        return candidates[0][0]

    return None


def _build_file_level_graph():
    """Build file-level dependency graph"""
    import json
    # Run function registry analysis
    script_path = os.path.join(os.path.dirname(DIR), 'scripts', 'function-registry.js')
    result = subprocess.run(
        ['node', script_path],
        capture_output=True,
        text=True,
        timeout=30
    )

    if result.returncode != 0:
        return jsonify({'status': 'error', 'message': f'Script failed: {result.stderr}'}), 500

    # Read the generated JSON report
    json_path = os.path.join(os.path.dirname(DIR), 'coverage', 'function-registry.json')
    if not os.path.exists(json_path):
        return jsonify({'status': 'error', 'message': 'Report file not found'}), 500

    with open(json_path, 'r') as f:
        data = json.load(f)

    # Also get load order data for severity info
    load_result = subprocess.run(
        ['node', script_path, '--check-load-order', '--json'],
        capture_output=True,
        text=True,
        timeout=30
    )
    load_data = {}
    if load_result.returncode == 0:
        try:
            load_data = json.loads(load_result.stdout)
        except json.JSONDecodeError:
            pass

    # Build nodes (files)
    nodes = []
    file_stats = data.get('files', {})
    script_order = load_data.get('scriptOrder', [])

    for filename, stats in file_stats.items():
        nodes.append({
            'id': filename,
            'functions': stats.get('functionCount', 0),
            'loc': stats.get('loc', 0),
            'order': script_order.index(filename) if filename in script_order else 999
        })

    # Build edges (dependencies)
    edges = []
    edge_map = {}  # Track (source, target) -> {calls, severity}

    # Process forward references to get severity
    forward_refs = load_data.get('forwardRefs', [])
    for ref in forward_refs:
        source = ref.get('callFile')
        target = ref.get('defFile')
        severity = ref.get('severity', 'INFO')

        if source and target and source != target:
            key = (source, target)
            if key not in edge_map:
                edge_map[key] = {'calls': 0, 'severity': severity}
            edge_map[key]['calls'] += 1
            # Keep highest severity (ERROR > WARNING > INFO)
            if severity == 'ERROR' or (severity == 'WARNING' and edge_map[key]['severity'] == 'INFO'):
                edge_map[key]['severity'] = severity

    # Process all cross-file function calls to get call counts
    functions = data.get('functions', {})
    for func_name, func_data in functions.items():
        defs = func_data.get('definitions', [])
        call_sites = func_data.get('callSites', [])

        if not defs or not call_sites:
            continue

        # Get all files where function is defined
        def_files = set(d.get('file') for d in defs if d.get('file'))

        # Count calls from other files
        for site in call_sites:
            source = site.get('file')
            if not source:
                continue

            # If calling from different file, it's a dependency
            for target in def_files:
                if source != target:
                    key = (source, target)
                    if key not in edge_map:
                        edge_map[key] = {'calls': 0, 'severity': None}
                    edge_map[key]['calls'] += 1

    # Convert edge_map to array
    for (source, target), data in edge_map.items():
        edges.append({
            'source': source,
            'target': target,
            'calls': data['calls'],
            'severity': data['severity']
        })

    return jsonify({
        'status': 'ok',
        'level': 'file',
        'nodes': nodes,
        'edges': edges
    })


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
def local_file():
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
