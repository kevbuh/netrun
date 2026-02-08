"""Vault .md file helpers shared across routes (vault, social/blog)."""
import os
import re
import socket
import subprocess

from persistence import VAULT_DIR, get_user_data, set_user_data


def _read_vault_md(fpath):
    """Read a vault note from .md file with YAML frontmatter."""
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    if not content.startswith('---\n'):
        return None
    parts = content.split('---\n', 2)
    if len(parts) < 3:
        return None
    import yaml
    try:
        meta = yaml.safe_load(parts[1])
    except Exception:
        return None
    if not isinstance(meta, dict):
        return None
    meta['content'] = parts[2].strip('\n') if len(parts) > 2 else ''
    return meta


def _write_vault_md(fpath, note):
    """Write a vault note to .md file with YAML frontmatter."""
    import yaml
    content = note.get('content', '')
    meta = {k: v for k, v in note.items() if k != 'content' and v is not None}
    frontmatter = yaml.dump(meta, default_flow_style=False, allow_unicode=True, sort_keys=False)
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write('---\n')
        f.write(frontmatter)
        f.write('---\n')
        f.write(content)


def _sanitize_vault_filename(title):
    """Sanitize a note title to be a valid filename."""
    name = re.sub(r'[<>:"/\\|?*]', '', title)
    name = re.sub(r'[\s_]+', ' ', name).strip()
    if len(name) > 100:
        name = name[:100].rsplit(' ', 1)[0]
    return name or 'Untitled'


def _find_vault_note_by_id(user_vault, note_id):
    """Find a vault note file by its ID. Returns (filepath, note) or (None, None)."""
    if not os.path.isdir(user_vault):
        return None, None
    for fname in os.listdir(user_vault):
        if not fname.endswith('.md'):
            continue
        fpath = os.path.join(user_vault, fname)
        try:
            note = _read_vault_md(fpath)
            if note and note.get('id') == note_id:
                return fpath, note
        except Exception:
            pass
    return None, None


def _get_user_vault_path(google_id):
    """Get the vault path for a user, checking for custom path first."""
    custom_path = get_user_data(google_id, 'vaultPath')
    if custom_path and os.path.isdir(custom_path):
        return custom_path
    default_path = os.path.join(VAULT_DIR, google_id)
    os.makedirs(default_path, exist_ok=True)
    return default_path


def _set_user_vault_path(google_id, path):
    """Set a custom vault path for a user. Returns (success, message)."""
    if not path:
        set_user_data(google_id, 'vaultPath', None)
        return True, 'Vault path reset to default'
    expanded_path = os.path.expanduser(path)
    if not os.path.exists(expanded_path):
        try:
            os.makedirs(expanded_path, exist_ok=True)
        except Exception as e:
            return False, f'Cannot create directory: {str(e)}'
    if not os.path.isdir(expanded_path):
        return False, 'Path is not a directory'
    test_file = os.path.join(expanded_path, '.vault_test')
    try:
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
    except Exception as e:
        return False, f'Directory is not writable: {str(e)}'
    set_user_data(google_id, 'vaultPath', expanded_path)
    return True, f'Vault path set to {expanded_path}'


def _find_free_port():
    """Find an available TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


def _vibe_ensure_git(vault_path):
    """Initialize a git repo in the vault if one doesn't exist."""
    git_dir = os.path.join(vault_path, '.git')
    if not os.path.isdir(git_dir):
        subprocess.run(['git', 'init'], cwd=vault_path, capture_output=True, text=True, timeout=10)
        subprocess.run(['git', 'add', '.'], cwd=vault_path, capture_output=True, text=True, timeout=10)
        subprocess.run(['git', 'commit', '-m', 'Initial commit', '--allow-empty'],
                       cwd=vault_path, capture_output=True, text=True, timeout=10)


def _vibe_run_git(cmd, body, vault_path):
    """Run a read-only git command on the vault directory and return parsed results."""
    _vibe_ensure_git(vault_path)

    def _run(args, max_output=50000):
        r = subprocess.run(['git'] + args, cwd=vault_path, capture_output=True, text=True, timeout=10)
        out = r.stdout[:max_output] if r.stdout else ''
        if r.returncode != 0 and r.stderr:
            return {'error': r.stderr[:2000]}
        return out

    if cmd == 'status':
        out = _run(['status', '--porcelain', '-b'])
        if isinstance(out, dict):
            return out
        return {'output': out}

    elif cmd == 'files':
        changed_out = _run(['status', '--porcelain'])
        changed = {}
        if isinstance(changed_out, str):
            for line in changed_out.strip().split('\n'):
                if not line:
                    continue
                status = line[:2].strip()
                path = line[3:]
                changed[path] = status
        tracked_out = _run(['ls-files'])
        if isinstance(tracked_out, dict):
            return tracked_out
        files = []
        seen = set()
        for path, status in changed.items():
            files.append({'status': status, 'path': path})
            seen.add(path)
        for line in tracked_out.strip().split('\n'):
            if not line or line in seen:
                continue
            files.append({'status': ' ', 'path': line})
        return {'files': files}

    elif cmd == 'branches':
        out = _run(['branch', '-a', '--format=%(HEAD)%(refname:short)\t%(upstream:track)\t%(objectname:short)\t%(committerdate:relative)'])
        if isinstance(out, dict):
            return out
        branches = []
        for line in out.strip().split('\n'):
            if not line:
                continue
            current = line.startswith('*')
            parts = line.lstrip('* ').split('\t')
            name = parts[0] if parts else ''
            track = parts[1] if len(parts) > 1 else ''
            hash_ = parts[2] if len(parts) > 2 else ''
            date = parts[3] if len(parts) > 3 else ''
            branches.append({'name': name, 'current': current, 'track': track, 'hash': hash_, 'date': date})
        return {'branches': branches}

    elif cmd == 'log':
        branch = body.get('branch', '')
        args = ['log', '--oneline', '--graph', '-50', '--format=%h\t%s\t%an\t%ar']
        if branch:
            args.append(branch)
        out = _run(args)
        if isinstance(out, dict):
            return out
        commits = []
        for line in out.strip().split('\n'):
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) >= 4:
                commits.append({'hash': parts[0].strip('* |/\\'), 'subject': parts[1], 'author': parts[2], 'date': parts[3]})
        return {'commits': commits}

    elif cmd == 'stash':
        out = _run(['stash', 'list'])
        if isinstance(out, dict):
            return out
        entries = [l for l in out.strip().split('\n') if l]
        return {'entries': entries}

    elif cmd == 'diff':
        file_ = body.get('file', '')
        args = ['diff']
        if file_:
            args.append('--')
            args.append(file_)
        out = _run(args)
        if isinstance(out, dict):
            return out
        staged = _run(['diff', '--cached'] + (['--', file_] if file_ else []))
        if isinstance(staged, dict):
            staged = ''
        combined = ''
        if staged:
            combined += '=== Staged ===\n' + staged + '\n'
        if out:
            combined += '=== Unstaged ===\n' + out
        if not combined:
            combined = 'No changes'
        return {'output': combined}

    elif cmd == 'show':
        ref = body.get('ref', 'HEAD')
        if not re.match(r'^[a-zA-Z0-9_./@{}\-: ]+$', ref):
            return {'error': 'Invalid ref'}
        out = _run(['show', '--stat', '--patch', ref])
        if isinstance(out, dict):
            return out
        return {'output': out}

    elif cmd == 'reflog':
        out = _run(['reflog', '--format=%h\t%gd\t%gs\t%ar', '-50'])
        if isinstance(out, dict):
            return out
        entries = [l for l in out.strip().split('\n') if l]
        return {'entries': entries}

    return {'error': 'Unknown command'}
