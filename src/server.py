#!/usr/bin/env python3
import argparse
import http.server
import urllib.request
import ssl
import os
import json
import re
import shutil
import time
import uuid
import subprocess
import sys
import concurrent.futures
import threading
import tempfile
import base64
import socket
from urllib.parse import unquote as url_unquote

# Parse args before importing persistence so ARXIV_DATA_DIR is set
_parser = argparse.ArgumentParser(description='Alpha server')
_parser.add_argument('--port', type=int, default=8000, help='Port to listen on')
_parser.add_argument('--data-dir', default=None, help='Directory for user data (DB, experiments, etc.)')
_parser.add_argument('--static-dir', default=None, help='Directory for static files to serve')
_args = _parser.parse_args()

if _args.data_dir:
    os.environ['ARXIV_DATA_DIR'] = _args.data_dir

from persistence import (
    DIR, CACHE_TTL, EXPERIMENTS_DIR, BLOCKED_TITLES_FILE, PROMPT_FILE, VAULT_DIR,
    _cache,
    read_blocked_titles, write_blocked_titles,
    read_saved_content, write_saved_content,
    slugify, unique_slug,
    read_meta, write_meta,
    read_prompt, write_prompt, get_active_prompt,
    DEFAULT_VERDICT_PROMPT, DEFAULT_SCORING_PROMPT,
    classify_title, cached_fetch,
    upsert_google_user, get_user_info, create_session,
    get_session_user, delete_session, set_username, delete_user,
    get_all_user_data, get_user_data, set_user_data, set_user_data_bulk,
    create_team, get_user_teams, get_team, delete_team,
    invite_to_team, get_pending_invites, respond_to_invite,
    remove_team_member, set_experiment_team, remove_experiment_team,
    get_experiment_team, get_team_experiments,
    set_experiment_owner, get_user_experiment_ids, user_can_access_experiment,
    get_user_calendar, create_calendar_event, update_calendar_event, delete_calendar_event,
    get_user_todos, create_todo, update_todo, delete_todo,
    db_get_comments, db_create_comment, db_delete_comment,
    get_public_user_info, get_user_public_stats, get_user_recent_comments, create_repost, delete_repost, get_user_reposts, get_user_feed_sources,
    set_blog_vote, get_blog_votes,
    ACHIEVEMENTS, get_user_achievements, grant_achievement, has_achievement,
    get_user_shared_experiments, get_user_public_teams, search_users, list_users,
    rename_team,
    update_user_picture, update_user_profile_bg, get_user_accent_color,
    set_profile_private, are_teammates,
    touch_last_seen, update_user_status,
    set_team_private, set_team_parent, get_team_children, get_team_ancestors,
    send_direct_message, get_direct_messages, mark_message_read,
    delete_direct_message, get_unread_message_count, get_user_by_username,
    send_team_message, get_team_messages, update_team_message, delete_team_message,
    toggle_reaction,
    mark_team_chat_read, get_unread_team_chats, get_unread_team_chat_count,
    get_team_todos, create_team_todo, update_team_todo, delete_team_todo,
    get_my_assigned_todos,
    get_adblock_stats, update_adblock_lists, clean_html,
    get_cached_references, set_cached_references,
    get_cached_author, set_cached_author,
)
from kernels import (
    _get_kernel, _kill_kernel, _get_python_path,
    _validate_package_names, _create_venv,
    _execute_code, _execute_code_streaming,
)

PORT = _args.port
GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com'

# Neuralook — trained models kept in memory for inference (keyed by method name)
_neuralook_models = {}  # { 'cnn': model, 'cnn_headpose': model, ... }
_neuralook_screen = None  # (screen_w, screen_h, eye_w, eye_h)
_whisper_model = None

# In-memory cache for extracted document text: url -> { text, pages }
_extract_cache = {}

# In-memory cache for Semantic Scholar API responses to avoid rate limits
# Format: { cache_key: { 'data': ..., 'ts': timestamp } }
_s2_cache = {}
_S2_CACHE_TTL = 3600  # 1 hour
_loc_history_cache = None
_loc_history_ts = 0
# In-memory cache for paper insights: url -> { repos, contribution }
_insights_cache = {}
# On-disk cache for URL-to-PDF conversions: url -> file path
_pdf_cache_dir = os.path.join(DIR, '.pdf-cache')
os.makedirs(_pdf_cache_dir, exist_ok=True)
_pdf_cache = {}  # url -> pdf_path

# Uploads directory for profile pictures and backgrounds
UPLOADS_DIR = os.path.join(DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)


# ── Vault .md file helpers (YAML frontmatter + content) ──
def _read_vault_md(fpath):
    """Read a vault note from .md file with YAML frontmatter."""
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    if not content.startswith('---\n'):
        return None
    parts = content.split('---\n', 2)
    if len(parts) < 3:
        return None
    # Parse YAML frontmatter
    import yaml
    try:
        meta = yaml.safe_load(parts[1])
    except:
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
    import re
    # Remove or replace invalid characters
    name = re.sub(r'[<>:"/\\|?*]', '', title)
    # Replace multiple spaces/underscores with single space
    name = re.sub(r'[\s_]+', ' ', name).strip()
    # Limit length
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
        except:
            pass
    return None, None


# ── Marimo notebook server management ──
_marimo_servers = {}  # {note_id: {proc, port, py_path}}


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
        if isinstance(out, dict): return out
        return {'output': out}

    elif cmd == 'files':
        # Show changed files first, then all tracked files
        changed_out = _run(['status', '--porcelain'])
        changed = {}
        if isinstance(changed_out, str):
            for line in changed_out.strip().split('\n'):
                if not line: continue
                status = line[:2].strip()
                path = line[3:]
                changed[path] = status
        # All tracked files
        tracked_out = _run(['ls-files'])
        if isinstance(tracked_out, dict): return tracked_out
        files = []
        seen = set()
        # Changed files first
        for path, status in changed.items():
            files.append({'status': status, 'path': path})
            seen.add(path)
        # Then tracked files not already listed
        for line in tracked_out.strip().split('\n'):
            if not line or line in seen: continue
            files.append({'status': ' ', 'path': line})
        return {'files': files}

    elif cmd == 'branches':
        out = _run(['branch', '-a', '--format=%(HEAD)%(refname:short)\t%(upstream:track)\t%(objectname:short)\t%(committerdate:relative)'])
        if isinstance(out, dict): return out
        branches = []
        for line in out.strip().split('\n'):
            if not line: continue
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
        if isinstance(out, dict): return out
        commits = []
        for line in out.strip().split('\n'):
            if not line: continue
            parts = line.split('\t')
            if len(parts) >= 4:
                commits.append({'hash': parts[0].strip('* |/\\'), 'subject': parts[1], 'author': parts[2], 'date': parts[3]})
        return {'commits': commits}

    elif cmd == 'stash':
        out = _run(['stash', 'list'])
        if isinstance(out, dict): return out
        entries = [l for l in out.strip().split('\n') if l]
        return {'entries': entries}

    elif cmd == 'diff':
        file_ = body.get('file', '')
        args = ['diff']
        if file_:
            args.append('--')
            args.append(file_)
        out = _run(args)
        if isinstance(out, dict): return out
        # Also check staged diff
        staged = _run(['diff', '--cached'] + (['--', file_] if file_ else []))
        if isinstance(staged, dict): staged = ''
        combined = ''
        if staged: combined += '=== Staged ===\n' + staged + '\n'
        if out: combined += '=== Unstaged ===\n' + out
        if not combined: combined = 'No changes'
        return {'output': combined}

    elif cmd == 'show':
        ref = body.get('ref', 'HEAD')
        # Sanitize ref: only allow safe characters
        if not re.match(r'^[a-zA-Z0-9_./@{}\-: ]+$', ref):
            return {'error': 'Invalid ref'}
        out = _run(['show', '--stat', '--patch', ref])
        if isinstance(out, dict): return out
        return {'output': out}

    elif cmd == 'reflog':
        out = _run(['reflog', '--format=%h\t%gd\t%gs\t%ar', '-50'])
        if isinstance(out, dict): return out
        entries = [l for l in out.strip().split('\n') if l]
        return {'entries': entries}

    return {'error': 'Unknown command'}


def _get_user_vault_path(google_id):
    """Get the vault path for a user, checking for custom path first."""
    # Check for custom vault path in user data
    custom_path = get_user_data(google_id, 'vaultPath')
    if custom_path and os.path.isdir(custom_path):
        return custom_path
    # Default to standard vault directory
    default_path = os.path.join(VAULT_DIR, google_id)
    os.makedirs(default_path, exist_ok=True)
    return default_path


def _set_user_vault_path(google_id, path):
    """Set a custom vault path for a user. Returns success status and message."""
    if not path:
        # Clear custom path, revert to default
        set_user_data(google_id, 'vaultPath', None)
        return True, 'Vault path reset to default'
    # Expand user path (e.g., ~/Documents)
    expanded_path = os.path.expanduser(path)
    # Check if path exists or can be created
    if not os.path.exists(expanded_path):
        try:
            os.makedirs(expanded_path, exist_ok=True)
        except Exception as e:
            return False, f'Cannot create directory: {str(e)}'
    if not os.path.isdir(expanded_path):
        return False, 'Path is not a directory'
    # Check if writable
    test_file = os.path.join(expanded_path, '.vault_test')
    try:
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
    except Exception as e:
        return False, f'Directory is not writable: {str(e)}'
    set_user_data(google_id, 'vaultPath', expanded_path)
    return True, f'Vault path set to {expanded_path}'


# Auto-create _unstructured pseudo-experiment for loose files
_unstructured_dir = os.path.join(EXPERIMENTS_DIR, '_unstructured')
os.makedirs(_unstructured_dir, exist_ok=True)
_unstructured_meta = os.path.join(_unstructured_dir, 'meta.json')
if not os.path.isfile(_unstructured_meta):
    with open(_unstructured_meta, 'w') as f:
        json.dump({'title': 'Unstructured Files', 'desc': '', 'created': None, 'runs': []}, f)


_static_dir = _args.static_dir or DIR

# ── Chat tool definitions for Ollama tool calling ──
CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web using DuckDuckGo. Returns top results with titles, URLs, and snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_papers",
            "description": "Search for academic papers on arXiv. Returns titles, URLs, authors, and summaries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query for papers"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": "Fetch and extract text content from a URL (web page or PDF).",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_to_reading_list",
            "description": "Bookmark a post or paper to the user's reading list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL of the post to bookmark"},
                    "title": {"type": "string", "description": "Title of the post"}
                },
                "required": ["url", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Navigate the app to a specific view.",
            "parameters": {
                "type": "object",
                "properties": {
                    "view": {"type": "string", "description": "View to navigate to: home, experiments, saved, calendar, settings, quality"}
                },
                "required": ["view"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_experiment",
            "description": "Create a new experiment/project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Title for the experiment"},
                    "description": {"type": "string", "description": "Description of the experiment"}
                },
                "required": ["title"]
            }
        }
    }
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=_static_dir, **kwargs)

    def handle_one_request(self):
        """Override to intercept WebSocket upgrades before normal HTTP processing."""
        try:
            self.raw_requestline = self.rfile.readline(65537)
            if len(self.raw_requestline) > 65536:
                self.requestline = ''
                self.request_version = ''
                self.command = ''
                self.send_error(414)
                return
            if not self.raw_requestline:
                self.close_connection = True
                return
            if not self.parse_request():
                return

            # Check for WebSocket upgrade BEFORE calling the method
            if self.path.startswith('/ws/terminal') and self.headers.get('Upgrade', '').lower() == 'websocket':
                from terminal_server import handle_websocket_upgrade_raw
                # Parse cwd from query param
                cwd = None
                if '?' in self.path:
                    from urllib.parse import urlparse, parse_qs
                    qs = parse_qs(urlparse(self.path).query)
                    cwd = qs.get('cwd', [None])[0]
                    if cwd and not os.path.isdir(cwd):
                        cwd = None
                handle_websocket_upgrade_raw(self, cwd=cwd)
                return

            mname = 'do_' + self.command
            if not hasattr(self, mname):
                self.send_error(501, "Unsupported method (%r)" % self.command)
                return
            method = getattr(self, mname)
            method()
            self.wfile.flush()
        except TimeoutError as e:
            self.log_error("Request timed out: %r", e)
            self.close_connection = True
            return

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _match(self, pattern):
        return re.match(pattern, self.path)

    def _build_arxiv_query(self, raw):
        """Build arXiv API search_query from user input.
        Supports: title:"phrase", title:word, "phrase", by:author, bare words.
        Maps to arXiv fields: ti: (title), au: (author), all: (everything)."""
        import shlex
        parts = []
        # Extract by: — everything after by: is the author name
        by_match = re.search(r'\bby:(.+)', raw)
        if by_match:
            author = by_match.group(1).strip()
            if author:
                parts.append(f'au:"{author}"')
            raw = raw[:by_match.start()].strip()
        # Extract title:"quoted" → ti:"quoted"
        raw = re.sub(r'title:"([^"]+)"', lambda m: (parts.append(f'ti:"{m.group(1)}"'), '')[1], raw)
        # Extract "quoted phrases" → all:"phrase"
        raw = re.sub(r'"([^"]+)"', lambda m: (parts.append(f'all:"{m.group(1)}"'), '')[1], raw)
        tokens = raw.split()
        bare_words = []
        for t in tokens:
            if t.startswith('title:'):
                val = t[6:]
                if val: parts.append(f'ti:{val}')
            elif t.startswith('source:') or t.startswith('sort:'):
                continue  # client-only prefixes
            else:
                bare_words.append(t)
        if bare_words:
            phrase = ' '.join(bare_words)
            parts.append(f'all:"{phrase}"')
        return ' AND '.join(parts) if parts else 'all:*'

    def _execute_chat_tool(self, name, args):
        """Execute a chat tool and return the result dict."""
        try:
            if name == 'web_search':
                return self._tool_web_search(args.get('query', ''))
            elif name == 'search_papers':
                return self._tool_search_papers(args.get('query', ''))
            elif name == 'fetch_page':
                return self._tool_fetch_page(args.get('url', ''))
            elif name == 'save_to_reading_list':
                # Client-side action — send SSE event
                self.wfile.write(f'event: action\ndata: {json.dumps({"type": "bookmark", "url": args.get("url", ""), "title": args.get("title", "")})}\n\n'.encode())
                self.wfile.flush()
                return {"status": "ok", "message": "Post bookmarked"}
            elif name == 'navigate':
                self.wfile.write(f'event: action\ndata: {json.dumps({"type": "navigate", "view": args.get("view", "home")})}\n\n'.encode())
                self.wfile.flush()
                return {"status": "ok", "message": f"Navigated to {args.get('view', 'home')}"}
            elif name == 'create_experiment':
                return self._tool_create_experiment(args.get('title', ''), args.get('description', ''))
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            return {"error": str(e)}

    def _tool_web_search(self, query):
        """DuckDuckGo search, returns top 5 results."""
        if not query:
            return {"results": []}
        search_url = 'https://html.duckduckgo.com/html/?q=' + urllib.request.quote(query)
        req = urllib.request.Request(search_url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            html = resp.read().decode('utf-8', errors='replace')
        results = []
        title_pattern = re.compile(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL)
        snippet_pattern = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL)
        titles = title_pattern.findall(html)
        snippets = snippet_pattern.findall(html)
        for i, (url, title) in enumerate(titles[:5]):
            clean_title = re.sub(r'<[^>]+>', '', title).strip()
            snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ''
            if 'uddg=' in url:
                actual = re.search(r'uddg=([^&]+)', url)
                if actual:
                    url = urllib.request.unquote(actual.group(1))
            results.append({'title': clean_title, 'url': url, 'snippet': snippet})
        return {"results": results}

    def _tool_search_papers(self, query):
        """arXiv API search, returns top 5 papers."""
        if not query:
            return {"papers": []}
        arxiv_query = self._build_arxiv_query(query)
        search_url = (
            f'https://export.arxiv.org/api/query?'
            f'search_query={urllib.request.quote(arxiv_query)}'
            f'&start=0&max_results=5'
            f'&sortBy=relevance&sortOrder=descending'
        )
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            data = resp.read().decode('utf-8', errors='replace')
        # Parse XML response
        papers = []
        entries = re.findall(r'<entry>(.*?)</entry>', data, re.DOTALL)
        for entry in entries[:5]:
            title_m = re.search(r'<title>(.*?)</title>', entry, re.DOTALL)
            summary_m = re.search(r'<summary>(.*?)</summary>', entry, re.DOTALL)
            link_m = re.search(r'<id>(.*?)</id>', entry)
            authors = re.findall(r'<name>(.*?)</name>', entry)
            papers.append({
                'title': re.sub(r'\s+', ' ', title_m.group(1)).strip() if title_m else '',
                'url': link_m.group(1).strip() if link_m else '',
                'authors': authors[:3],
                'summary': re.sub(r'\s+', ' ', summary_m.group(1)).strip()[:300] if summary_m else ''
            })
        return {"papers": papers}

    def _tool_fetch_page(self, url):
        """Extract text from a URL."""
        if not url:
            return {"error": "URL required"}
        # Check cache
        if url in _extract_cache:
            text = _extract_cache[url].get('text', '')
            return {"text": text[:8000], "truncated": len(text) > 8000}
        is_arxiv = 'arxiv.org' in url
        if is_arxiv:
            pdf_url = url.replace('/abs/', '/pdf/')
            if not pdf_url.endswith('.pdf'):
                pdf_url += '.pdf'
            req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                pdf_bytes = resp.read()
            import fitz
            tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
            tmp.write(pdf_bytes)
            tmp.close()
            try:
                doc = fitz.open(tmp.name)
                pages = [doc[i].get_text() for i in range(len(doc))]
                doc.close()
            finally:
                os.unlink(tmp.name)
            text = '\n\n---\n\n'.join(pages)
        else:
            from html.parser import HTMLParser
            html_bytes = cached_fetch(url, timeout=30)
            html_str = html_bytes.decode('utf-8', errors='replace')
            class TE(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts = []
                    self._skip = False
                def handle_starttag(self, tag, attrs):
                    if tag in ('script', 'style', 'noscript'):
                        self._skip = True
                def handle_endtag(self, tag):
                    if tag in ('script', 'style', 'noscript'):
                        self._skip = False
                def handle_data(self, data):
                    if not self._skip:
                        t = data.strip()
                        if t:
                            self.parts.append(t)
            ext = TE()
            ext.feed(html_str)
            text = '\n'.join(ext.parts)
        _extract_cache[url] = {'text': text, 'pages': 1}
        return {"text": text[:8000], "truncated": len(text) > 8000}

    def _tool_create_experiment(self, title, desc=''):
        """Create a new experiment."""
        if not title:
            return {"error": "Title required"}
        slug = unique_slug(slugify(title))
        exp_dir = os.path.join(EXPERIMENTS_DIR, slug)
        os.makedirs(exp_dir, exist_ok=True)
        meta = {'title': title, 'desc': desc, 'created': None, 'runs': []}
        write_meta(slug, meta)
        return {"id": slug, "title": title, "message": f"Experiment '{title}' created"}

    def do_GET(self):
        # WebSocket upgrade is handled in handle_one_request() before we get here
        if self.path == '/ws/terminal':
            self._send_json({'error': 'Expected WebSocket upgrade'}, 400)
            return

        if self.path == '/api/settings':
            self._send_json({'ok': True})
            return

        elif self.path == '/api/neuralook/calibration':
            calib_path = os.path.join(DIR, 'neuralook_calibration.json')
            if os.path.exists(calib_path):
                with open(calib_path, 'r') as f:
                    self._send_json(json.loads(f.read()))
            else:
                self._send_json({'error': 'No calibration data saved'}, 404)
            return

        elif self.path == '/favicon.ico':
            favicon = os.path.join(DIR, 'favicon.png')
            if os.path.exists(favicon):
                with open(favicon, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(404)
                self.end_headers()
            return

        elif self.path == '/feed':
            try:
                data = cached_fetch('https://rss.arxiv.org/rss/cs')
                self.send_response(200)
                self.send_header('Content-Type', 'application/xml')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path == '/hn-feed':
            try:
                # Cache the full HN response as JSON bytes
                cache_key = 'hn-feed'
                now = time.time()
                if cache_key in _cache and now - _cache[cache_key][1] < CACHE_TTL:
                    stories = json.loads(_cache[cache_key][0])
                else:
                    ctx = ssl._create_unverified_context()
                    req = urllib.request.Request(
                        'https://hacker-news.firebaseio.com/v0/beststories.json',
                        headers={'User-Agent': 'Mozilla/5.0'}
                    )
                    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                        ids = json.loads(resp.read())[:30]

                    def fetch_hn_item(item_id):
                        url = f'https://hacker-news.firebaseio.com/v0/item/{item_id}.json'
                        r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(r, timeout=10, context=ctx) as resp:
                            return json.loads(resp.read())

                    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                        items = list(pool.map(fetch_hn_item, ids))

                    stories = [it for it in items if it and it.get('type') == 'story']
                    _cache[cache_key] = (json.dumps(stories).encode(), now)
                self._send_json(stories)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/polymarket-feed':
            try:
                html = cached_fetch('https://polymarket.com/breaking', timeout=15)
                html_str = html.decode('utf-8', errors='replace')
                marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">'
                idx = html_str.find(marker)
                if idx == -1:
                    self._send_json({'error': 'Could not find data'}, 502)
                    return
                start = idx + len(marker)
                end = html_str.find('</script>', start)
                next_data = json.loads(html_str[start:end])
                queries = next_data['props']['pageProps']['dehydratedState']['queries']
                markets = []
                for q in queries:
                    key = q.get('queryKey', [])
                    if 'biggest-movers' in key:
                        markets = q['state']['data'].get('markets', [])
                        break
                top5 = []
                for m in markets:
                    slug = m.get('slug', '')
                    prices = m.get('outcomePrices', ['0', '0'])
                    yes_pct = round(float(prices[0]) * 100)
                    change = m.get('oneDayPriceChange', 0)
                    change_pct = round(change * 100)
                    volume = 0
                    if m.get('events'):
                        volume = round(m['events'][0].get('volume', 0))
                    top5.append({
                        'question': m.get('question', ''),
                        'slug': slug,
                        'url': f'https://polymarket.com/event/{m["events"][0]["slug"]}' if m.get('events') else f'https://polymarket.com/event/{slug}',
                        'image': m.get('image', ''),
                        'yesPct': yes_pct,
                        'changePct': change_pct,
                        'volume': volume
                    })
                self._send_json(top5)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path.startswith('/api/local-file'):
            from urllib.parse import urlparse, parse_qs, unquote
            qs = parse_qs(urlparse(self.path).query)
            file_path = unquote(qs.get('path', [''])[0]).strip()
            if not file_path or not os.path.isfile(file_path):
                self.send_response(404)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'File not found')
                return
            import mimetypes
            ct = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
            try:
                with open(file_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path.startswith('/api/arxiv-pdf'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            arxiv_id = qs.get('id', [''])[0].strip()
            if not arxiv_id:
                self.send_response(400)
                self.end_headers()
                return
            pdf_url = f'https://arxiv.org/pdf/{arxiv_id}.pdf'
            try:
                req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                    data = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/pdf')
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path.startswith('/api/url-to-pdf'):
            from urllib.parse import urlparse, parse_qs
            import hashlib
            qs = parse_qs(urlparse(self.path).query)
            url = qs.get('url', [''])[0].strip()
            if not url:
                self.send_response(400)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'url parameter required')
                return
            # Check disk cache
            url_hash = hashlib.md5(url.encode()).hexdigest()
            cached_path = os.path.join(_pdf_cache_dir, url_hash + '.pdf')
            if url in _pdf_cache and os.path.isfile(_pdf_cache[url]):
                cached_path = _pdf_cache[url]
            elif os.path.isfile(cached_path):
                _pdf_cache[url] = cached_path
            else:
                # Convert URL to PDF using headless Chrome
                chrome_paths = [
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    '/usr/bin/google-chrome',
                    '/usr/bin/chromium-browser',
                    '/usr/bin/chromium',
                ]
                chrome = None
                for p in chrome_paths:
                    if os.path.isfile(p):
                        chrome = p
                        break
                if not chrome:
                    self.send_response(500)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(b'Chrome not found')
                    return
                try:
                    result = subprocess.run(
                        [chrome, '--headless', '--disable-gpu', '--no-sandbox',
                         '--print-to-pdf=' + cached_path,
                         '--run-all-compositor-stages-before-draw',
                         '--virtual-time-budget=10000',
                         url],
                        capture_output=True, timeout=30
                    )
                    if not os.path.isfile(cached_path):
                        self.send_response(502)
                        self.send_header('Content-Type', 'text/plain')
                        self.end_headers()
                        self.wfile.write(b'PDF conversion failed')
                        return
                    _pdf_cache[url] = cached_path
                except subprocess.TimeoutExpired:
                    self.send_response(504)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(b'Conversion timed out')
                    return
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(str(e).encode())
                    return
            try:
                with open(cached_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path.startswith('/api/check-embed'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            url = qs.get('url', [''])[0].strip()
            if not url:
                self._send_json({'embeddable': False})
                return
            try:
                req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                    xfo = (resp.headers.get('X-Frame-Options') or '').upper()
                    csp = resp.headers.get('Content-Security-Policy') or ''
                    blocked = bool(xfo) or 'frame-ancestors' in csp
                    self._send_json({'embeddable': not blocked})
            except Exception:
                self._send_json({'embeddable': False})

        elif self.path.startswith('/api/link-preview'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            url = qs.get('url', [''])[0].strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                })
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
                    # Read limited amount to avoid large downloads
                    raw = resp.read(200_000)
                    html = raw.decode('utf-8', errors='replace')
                # Extract OpenGraph and standard meta tags
                def meta(prop):
                    for attr in ('property', 'name'):
                        m = re.search(rf'<meta\s+{attr}="{re.escape(prop)}"\s+content="([^"]*)"', html, re.I)
                        if m: return m.group(1)
                        m = re.search(rf'<meta\s+content="([^"]*)"\s+{attr}="{re.escape(prop)}"', html, re.I)
                        if m: return m.group(1)
                    return ''
                title = meta('og:title') or meta('twitter:title')
                if not title:
                    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.I | re.DOTALL)
                    title = re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else ''
                desc = meta('og:description') or meta('twitter:description') or meta('description')
                image = meta('og:image') or meta('twitter:image')
                # Make relative image URLs absolute
                if image and not image.startswith('http'):
                    parsed = urlparse(url)
                    if image.startswith('//'):
                        image = parsed.scheme + ':' + image
                    elif image.startswith('/'):
                        image = parsed.scheme + '://' + parsed.netloc + image
                    else:
                        image = url.rsplit('/', 1)[0] + '/' + image
                site = meta('og:site_name')
                parsed_url = urlparse(url)
                domain = parsed_url.netloc.replace('www.', '')
                favicon = parsed_url.scheme + '://' + parsed_url.netloc + '/favicon.ico'
                self._send_json({
                    'title': title[:200],
                    'description': desc[:300],
                    'image': image,
                    'site': site or domain,
                    'favicon': favicon,
                    'domain': domain
                })
            except Exception as e:
                self._send_json({'title': '', 'description': '', 'image': '', 'site': '', 'domain': '', 'error': str(e)})

        elif self.path.startswith('/api/web-search'):
            from urllib.parse import urlparse, parse_qs
            from html.parser import HTMLParser
            qs = parse_qs(urlparse(self.path).query)
            query = qs.get('q', [''])[0].strip()
            if not query:
                self._send_json({'results': []})
                return
            try:
                from persistence import log_usage
                log_usage('search_chat')
            except: pass
            try:
                search_url = 'https://html.duckduckgo.com/html/?q=' + urllib.request.quote(query)
                req = urllib.request.Request(search_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                })
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                    html = resp.read().decode('utf-8', errors='replace')
                # Parse DuckDuckGo HTML results
                results = []
                # Each result is in a div with class="result results_links results_links_deep web-result"
                # Title in <a class="result__a">, snippet in <a class="result__snippet">
                title_pattern = re.compile(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL)
                snippet_pattern = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL)
                titles = title_pattern.findall(html)
                snippets = snippet_pattern.findall(html)
                for i, (url, title) in enumerate(titles[:8]):
                    # Clean HTML tags from title and snippet
                    clean_title = re.sub(r'<[^>]+>', '', title).strip()
                    snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ''
                    # DuckDuckGo wraps URLs in a redirect; extract the actual URL
                    if 'uddg=' in url:
                        actual = re.search(r'uddg=([^&]+)', url)
                        if actual:
                            url = urllib.request.unquote(actual.group(1))
                    results.append({'title': clean_title, 'url': url, 'snippet': snippet})
                self._send_json({'results': results})
            except Exception as e:
                self._send_json({'results': [], 'error': str(e)})

        elif self.path.startswith('/api/stock-quote'):
            try:
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                symbol = qs.get('symbol', [''])[0].strip().upper()
                if not symbol:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(b'{"error":"symbol required"}')
                    return
                url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d'
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read())
                result = data.get('chart', {}).get('result', [{}])[0]
                meta = result.get('meta', {})
                price = meta.get('regularMarketPrice', 0)
                prev = meta.get('chartPreviousClose', 0)
                change = round(price - prev, 2) if prev else 0
                change_pct = round((change / prev) * 100, 2) if prev else 0
                name = meta.get('shortName', '') or meta.get('longName', '') or symbol
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'price': price, 'change': change, 'changePercent': change_pct, 'name': name}).encode())
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        elif self.path.startswith('/api/rss-proxy'):
            try:
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                feed_url = qs.get('url', [''])[0].strip()
                if not feed_url:
                    self.send_response(400)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(b'url parameter required')
                    return
                data = cached_fetch(feed_url)
                self.send_response(200)
                self.send_header('Content-Type', 'application/xml')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path.startswith('/api/arxiv-search'):
            try:
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                query = qs.get('q', [''])[0].strip()
                start = int(qs.get('start', ['0'])[0])
                max_results = int(qs.get('max_results', ['20'])[0])
                if not query:
                    self._send_json({'error': 'Query required'}, 400)
                    return
                arxiv_query = self._build_arxiv_query(query)
                search_url = (
                    f'https://export.arxiv.org/api/query?'
                    f'search_query={urllib.request.quote(arxiv_query)}'
                    f'&start={start}&max_results={max_results}'
                    f'&sortBy=relevance&sortOrder=descending'
                )
                req = urllib.request.Request(
                    search_url,
                    headers={'User-Agent': 'Mozilla/5.0'}
                )
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/xml')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(str(e).encode())

        # ── Ollama Models API ──
        elif self.path == '/api/models':
            try:
                req = urllib.request.Request("http://localhost:11434/api/tags")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read())
                models = [m['name'] for m in data.get('models', [])]
                self._send_json({'models': models})
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/vault/path':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json({'path': _get_user_vault_path(google_id)})

        # ── Vault Notes API ──
        elif self.path == '/api/vault/notes':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
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
                    except:
                        pass
            notes.sort(key=lambda n: n.get('updated', 0), reverse=True)
            self._send_json(notes)

        # ── Vault Path API ──
        elif self.path == '/api/vault/path':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            custom_path = get_user_data(google_id, 'vaultPath')
            default_path = os.path.join(VAULT_DIR, google_id)
            self._send_json({
                'path': custom_path or default_path,
                'isCustom': bool(custom_path),
                'default': default_path
            })

        elif m := self._match(r'^/api/vault/notes/([a-zA-Z0-9_-]+)$'):
            note_id = m.group(1)
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            user_vault = _get_user_vault_path(google_id)
            note_path, note = _find_vault_note_by_id(user_vault, note_id)
            if note:
                self._send_json(note)
            else:
                self._send_json({'error': 'Not found'}, 404)

        # ── Public Blog API (no auth required) ──
        elif m := self._match(r'^/api/blog/([^/]+)/([^/]+)$'):
            username = m.group(1)
            slug = m.group(2)
            # Find user by username
            user_info = get_public_user_info(username)
            if not user_info:
                self._send_json({'error': 'User not found'}, 404)
                return
            google_id = user_info['google_id']
            user_vault = _get_user_vault_path(google_id)
            viewer_google_id = self._get_user()
            if os.path.isdir(user_vault):
                for fname in os.listdir(user_vault):
                    if not fname.endswith('.md'):
                        continue
                    fpath = os.path.join(user_vault, fname)
                    try:
                        note = _read_vault_md(fpath)
                        if note and note.get('published') and note.get('slug') == slug:
                            votes = get_blog_votes(username, slug, viewer_google_id)
                            self._send_json({
                                'title': note.get('title', 'Untitled'),
                                'content': note.get('content', ''),
                                'author': username,
                                'published_at': note.get('published_at'),
                                'picture': user_info.get('picture'),
                                'upvotes': votes['upvotes'],
                                'downvotes': votes['downvotes'],
                                'userVote': votes['userVote']
                            })
                            return
                    except:
                        pass
            self._send_json({'error': 'Post not found'}, 404)

        elif m := self._match(r'^/api/blog/([^/]+)$'):
            # List all published posts by username
            username = m.group(1)
            user_info = get_public_user_info(username)
            if not user_info:
                self._send_json({'error': 'User not found'}, 404)
                return
            google_id = user_info['google_id']
            user_vault = _get_user_vault_path(google_id)
            posts = []
            if os.path.isdir(user_vault):
                for fname in os.listdir(user_vault):
                    if not fname.endswith('.md'):
                        continue
                    fpath = os.path.join(user_vault, fname)
                    try:
                        note = _read_vault_md(fpath)
                        if note and note.get('published'):
                            posts.append({
                                'title': note.get('title', 'Untitled'),
                                'slug': note.get('slug'),
                                'published_at': note.get('published_at')
                            })
                    except:
                        pass
            posts.sort(key=lambda p: p.get('published_at', 0), reverse=True)
            self._send_json({'posts': posts, 'author': username, 'picture': user_info.get('picture')})

        # ── Achievements API ──
        elif self.path == '/api/achievements':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            achievements = get_user_achievements(google_id)
            self._send_json({'achievements': achievements})

        elif m := self._match(r'^/api/achievements/([^/]+)$'):
            # Get achievements for a specific user by username
            username = m.group(1)
            user_info = get_public_user_info(username)
            if not user_info:
                self._send_json({'error': 'User not found'}, 404)
                return
            achievements = get_user_achievements(user_info['google_id'])
            self._send_json({'achievements': achievements})

        elif self.path == '/api/experiments':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
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
            self._send_json(experiments)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files$'):
            exp_id = m.group(1)
            if not self._check_experiment_access(exp_id):
                return
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
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
            self._send_json({'files': files, 'emptyDirs': empty_dirs})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/compile-tex/(.+)$'):
            exp_id = m.group(1)
            fname = url_unquote(m.group(2))
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath) or not fname.endswith('.tex'):
                self._send_json({'error': 'Not found'}, 404)
                return
            import subprocess as sp
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
                    sty_path = os.path.join(os.path.dirname(__file__), 'neurips_2023.sty')
                    if os.path.isfile(sty_path):
                        shutil.copy(sty_path, tmp)
                # First pdflatex pass
                result = sp.run(
                    ['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
                    cwd=tmp, capture_output=True, text=True, timeout=30
                )
                # Run bibtex if .bib files present
                aux_name = tex_basename.rsplit('.', 1)[0]
                if any(f.endswith('.bib') for f in os.listdir(tmp)):
                    sp.run(['bibtex', aux_name], cwd=tmp, capture_output=True, text=True, timeout=15)
                    # Two more pdflatex passes to resolve references
                    sp.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
                           cwd=tmp, capture_output=True, text=True, timeout=30)
                    result = sp.run(
                        ['pdflatex', '-interaction=nonstopmode', '-halt-on-error', tex_basename],
                        cwd=tmp, capture_output=True, text=True, timeout=30
                    )
                pdf_path = os.path.join(tmp, aux_name + '.pdf')
                if result.returncode != 0 or not os.path.isfile(pdf_path):
                    log = result.stdout + '\n' + result.stderr
                    self._send_json({'error': 'Compilation failed', 'log': log}, 400)
                    return
                with open(pdf_path, 'rb') as f:
                    pdf_data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf')
                self.send_header('Content-Length', str(len(pdf_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(pdf_data)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/raw/(.+)$'):
            exp_id = m.group(1)
            fname = url_unquote(m.group(2))
            if '..' in fname:
                self.send_response(400)
                self.end_headers()
                return
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath):
                self.send_response(404)
                self.end_headers()
                return
            ext = os.path.splitext(fname)[1].lower()
            mime_map = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
                        '.pdf': 'application/pdf'}
            mime = mime_map.get(ext, 'application/octet-stream')
            with open(fpath, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+)$'):
            exp_id = m.group(1)
            fname = url_unquote(m.group(2))
            if '..' in fname:
                self._send_json({'error': 'Invalid path'}, 400)
                return
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath):
                self._send_json({'error': 'Not found'}, 404)
                return
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
                self._send_json({'name': fname, 'content': f'data:{mime};base64,{data}', 'binary': True, 'mime': mime})
            else:
                try:
                    with open(fpath, 'r') as f:
                        content = f.read()
                    self._send_json({'name': fname, 'content': content})
                except UnicodeDecodeError:
                    with open(fpath, 'rb') as f:
                        data = base64.b64encode(f.read()).decode()
                    self._send_json({'name': fname, 'content': f'data:application/octet-stream;base64,{data}', 'binary': True, 'mime': 'application/octet-stream'})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/packages$'):
            exp_id = m.group(1)
            if not read_meta(exp_id):
                self._send_json({'error': 'Not found'}, 404)
                return
            python_path = _get_python_path(exp_id)
            try:
                result = subprocess.run(
                    [python_path, '-m', 'pip', 'list', '--format=json'],
                    capture_output=True, text=True, timeout=30
                )
                packages = json.loads(result.stdout) if result.returncode == 0 else []
                self._send_json(packages)
            except Exception:
                self._send_json([])

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
            if not self._check_experiment_access(exp_id):
                return
            meta = read_meta(exp_id)
            if meta:
                meta['id'] = exp_id
                self._send_json(meta)
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif self.path == '/api/venvs':
            venvs = []
            if os.path.isdir(EXPERIMENTS_DIR):
                for name in sorted(os.listdir(EXPERIMENTS_DIR)):
                    venv_python = os.path.join(EXPERIMENTS_DIR, name, 'venv', 'bin', 'python')
                    if os.path.exists(venv_python):
                        meta = read_meta(name)
                        title = (meta or {}).get('title', name)
                        venvs.append({'id': name, 'title': title, 'pythonPath': venv_python})
            self._send_json(venvs)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/venv-info$'):
            exp_id = m.group(1)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
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
            self._send_json(info)

        elif self.path == '/api/todos':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_user_todos(google_id))

        elif self.path == '/api/calendar':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_user_calendar(google_id))

        elif self.path == '/api/blocked-titles':
            self._send_json(read_blocked_titles())

        elif self.path == '/api/quality-prompt':
            self._send_json({
                'prompt': read_prompt(),
                'default': DEFAULT_VERDICT_PROMPT,
                'scoringPrompt': DEFAULT_SCORING_PROMPT
            })

        elif self.path.startswith('/api/saved-content'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            url = qs.get('url', [''])[0].strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            data = read_saved_content(url)
            if data is None:
                self._send_json({'error': 'not found'}, 404)
            else:
                self._send_json(data)

        elif self.path.startswith('/api/comments'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            paper_link = qs.get('paperLink', [''])[0].strip()
            self._send_json(db_get_comments(paper_link if paper_link else None))

        elif self.path == '/tex-preview':
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
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)

        elif self.path == '/api/auth/me':
            google_id = self._get_user()
            if google_id:
                info = get_user_info(google_id)
                if info:
                    self._send_json(info)
                else:
                    self._send_json({'google_id': google_id})
            else:
                self._send_json({'error': 'Not authenticated'}, 401)

        elif self.path == '/api/version':
            try:
                git_root = os.path.dirname(DIR)
                r = subprocess.run(['git', 'rev-list', '--count', 'HEAD'],
                                   capture_output=True, text=True, cwd=git_root, timeout=5)
                count = int(r.stdout.strip()) if r.returncode == 0 else 0
                h = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                                   capture_output=True, text=True, cwd=git_root, timeout=5)
                sha = h.stdout.strip() if h.returncode == 0 else ''
                self._send_json({'version': f'0.{count}', 'sha': sha})
            except:
                self._send_json({'version': '0.0', 'sha': ''})

        elif self.path == '/api/dev-stats':
            try:
                from persistence import _get_db
                conn = _get_db()
                users = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
                active_sessions = conn.execute('SELECT COUNT(*) FROM sessions WHERE expires > ?', (time.time(),)).fetchone()[0]
                # LOC and file count for src/
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
                            except: pass
                # Commits today
                commits_today = 0
                git_root = os.path.dirname(DIR)
                try:
                    today = time.strftime('%Y-%m-%d')
                    result = subprocess.run(['git', 'rev-list', '--count', '--since=' + today, 'HEAD'],
                                            capture_output=True, text=True, cwd=git_root)
                    commits_today = int(result.stdout.strip()) if result.returncode == 0 else 0
                except: pass
                # LOC history (last 30 days) - cached with 5 min TTL
                global _loc_history_cache, _loc_history_ts
                now_t = time.time()
                cache_stale = not isinstance(_loc_history_cache, list) or (now_t - _loc_history_ts > 300)
                if cache_stale:
                    loc_history = []
                    try:
                        # Get LOC totals per day via git show
                        result = subprocess.run(
                            ['git', 'log', '--reverse', '--format=%H %ad', '--date=short', '--since=30 days ago'],
                            capture_output=True, text=True, cwd=git_root)
                        if result.returncode == 0:
                            day_commits = {}
                            for line in result.stdout.strip().split('\n'):
                                if not line.strip(): continue
                                parts = line.split(' ', 1)
                                if len(parts) == 2:
                                    day_commits[parts[1]] = parts[0]
                            # Get add/delete stats per day via git log --numstat
                            day_stats = {}
                            stat_result = subprocess.run(
                                ['git', 'log', '--numstat', '--format=%ad', '--date=short', '--since=30 days ago', '--', 'src/'],
                                capture_output=True, text=True, cwd=git_root, timeout=30)
                            if stat_result.returncode == 0:
                                current_date = None
                                for sline in stat_result.stdout.split('\n'):
                                    sline = sline.strip()
                                    if not sline: continue
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
                                            except (ValueError, IndexError): pass
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
                                                except: pass
                                except: pass
                                ds = day_stats.get(date, {})
                                loc_history.append({
                                    'date': date, 'lines': lines,
                                    'added': ds.get('added', 0),
                                    'deleted': ds.get('deleted', 0),
                                })
                    except: pass
                    _loc_history_cache = loc_history
                    _loc_history_ts = now_t
                else:
                    loc_history = _loc_history_cache
                # Usage history
                usage_history = {}
                try:
                    from persistence import get_usage_history
                    usage_history = get_usage_history(30)
                except: pass
                # Git log (last 50 commits)
                git_log = []
                try:
                    r = subprocess.run(
                        ['git', 'log', '--format=%H|%an|%ad|%s', '--date=iso'],
                        capture_output=True, text=True, cwd=git_root, timeout=10)
                    if r.returncode == 0:
                        for line in r.stdout.strip().split('\n'):
                            if not line.strip(): continue
                            parts = line.split('|', 3)
                            if len(parts) == 4:
                                git_log.append({'sha': parts[0][:8], 'author': parts[1], 'date': parts[2], 'message': parts[3]})
                except: pass
                # Commits per day (last 30 days)
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
                except: pass
                self._send_json({
                    'users': users,
                    'active_sessions': active_sessions,
                    'total_loc': total_loc,
                    'files': file_count,
                    'commits_today': commits_today,
                    'loc_history': loc_history,
                    'usage_history': usage_history,
                    'git_log': git_log,
                    'commits_per_day': commits_per_day,
                })
            except Exception as e:
                self._send_json({'error': str(e)}, 500)

        elif self.path == '/api/teams':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_user_teams(google_id))

        elif m := self._match(r'^/api/teams/(\d+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team = get_team(int(m.group(1)))
            if not team:
                self._send_json({'error': 'Not found'}, 404)
                return
            team['children'] = get_team_children(team['id'])
            team['ancestors'] = get_team_ancestors(team['id'])
            self._send_json(team)

        elif self.path == '/api/inbox':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_pending_invites(google_id))

        elif self.path == '/api/team-experiments':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            teams = get_user_teams(google_id)
            result = []
            seen = set()
            for team in teams:
                exp_ids = get_team_experiments(team['id'])
                for eid in exp_ids:
                    if eid in seen:
                        continue
                    seen.add(eid)
                    meta = read_meta(eid)
                    if meta:
                        meta['id'] = eid
                        meta['team_id'] = team['id']
                        meta['team_name'] = team['name']
                        runs = meta.get('runs', [])
                        meta['runCount'] = len(runs)
                        ts = [r.get('created', 0) for r in runs] + [meta.get('created', 0) or 0]
                        exp_dir = os.path.join(EXPERIMENTS_DIR, eid)
                        for root, dirs, files in os.walk(exp_dir):
                            for fname in files:
                                try:
                                    ts.append(os.path.getmtime(os.path.join(root, fname)))
                                except OSError:
                                    pass
                        meta['lastUpdated'] = max(ts) if ts else 0
                        result.append(meta)
            result.sort(key=lambda e: e.get('lastUpdated', 0), reverse=True)
            self._send_json(result)

        elif self.path == '/api/messages':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_direct_messages(google_id))

        elif self.path == '/api/messages/unread-count':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            invites = len(get_pending_invites(google_id))
            messages = get_unread_message_count(google_id)
            chats = get_unread_team_chat_count(google_id)
            tasks = len(get_my_assigned_todos(google_id))
            self._send_json({'invites': invites, 'messages': messages, 'chats': chats, 'tasks': tasks, 'total': invites + messages + chats + tasks})

        elif (m := self._match(r'^/api/teams/(\d+)/messages$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            # Verify membership
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            self._send_json(get_team_messages(team_id))

        elif (m := self._match(r'^/api/teams/(\d+)/todos$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            self._send_json(get_team_todos(team_id))

        elif self.path == '/api/my-tasks':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_my_assigned_todos(google_id))

        elif self.path == '/api/inbox-chats':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            self._send_json(get_unread_team_chats(google_id))

        elif self.path.startswith('/api/users'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            # /api/users?q=... — search users, or list all if no q
            if self.path.startswith('/api/users?') or self.path == '/api/users':
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                q = qs.get('q', [''])[0].strip()
                if not q:
                    self._send_json(list_users())
                    return
                self._send_json(search_users(q))
            # /api/users/{username}/feeds
            elif (m := self._match(r'^/api/users/([^/]+)/feeds$')):
                username = url_unquote(m.group(1))
                info = get_public_user_info(username)
                if not info:
                    self._send_json({'error': 'User not found'}, 404)
                    return
                if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
                    self._send_json({'catalogFeeds': [], 'customFeeds': []})
                    return
                data = get_user_feed_sources(info['google_id'])
                catalog_keys = [k for k, v in data.get('feedSources', {}).items() if v]
                custom = [f for f in data.get('customFeeds', []) if f.get('enabled')]
                custom_out = [{'name': f.get('name', f.get('url', '')), 'url': f.get('url', '')} for f in custom]
                self._send_json({'catalogFeeds': catalog_keys, 'customFeeds': custom_out})
            # /api/users/{username}/comments
            elif (m := self._match(r'^/api/users/([^/]+)/comments$')):
                username = url_unquote(m.group(1))
                info = get_public_user_info(username)
                if not info:
                    self._send_json({'error': 'User not found'}, 404)
                    return
                if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
                    self._send_json([])
                    return
                self._send_json(get_user_recent_comments(info['google_id']))
            # /api/users/{username}/reposts
            elif (m := self._match(r'^/api/users/([^/]+)/reposts$')):
                username = url_unquote(m.group(1))
                info = get_public_user_info(username)
                if not info:
                    self._send_json({'error': 'User not found'}, 404)
                    return
                if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
                    self._send_json([])
                    return
                self._send_json(get_user_reposts(info['google_id']))
            # /api/users/{username}/teams
            elif (m := self._match(r'^/api/users/([^/]+)/teams$')):
                username = url_unquote(m.group(1))
                info = get_public_user_info(username)
                if not info:
                    self._send_json({'error': 'User not found'}, 404)
                    return
                teams = get_user_public_teams(info['google_id'], viewer_google_id=google_id)
                self._send_json(teams)
            # /api/users/{username}/experiments
            elif (m := self._match(r'^/api/users/([^/]+)/experiments$')):
                username = url_unquote(m.group(1))
                info = get_public_user_info(username)
                if not info:
                    self._send_json({'error': 'User not found'}, 404)
                    return
                if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
                    self._send_json([])
                    return
                exp_ids = get_user_shared_experiments(google_id, info['google_id'])
                result = []
                for eid in exp_ids:
                    meta = read_meta(eid)
                    if meta:
                        meta['id'] = eid
                        result.append(meta)
                self._send_json(result)
            # /api/users/{username} — profile info
            elif (m := self._match(r'^/api/users/([^/]+)$')):
                username = url_unquote(m.group(1))
                info = get_public_user_info(username)
                if not info:
                    self._send_json({'error': 'User not found'}, 404)
                    return
                # If profile is private and viewer is not a teammate, return limited info
                if info['profile_private'] and info['google_id'] != google_id and not are_teammates(google_id, info['google_id']):
                    self._send_json({'username': info['username'], 'picture': info['picture'], 'profile_private': True})
                    return
                stats = get_user_public_stats(info['google_id'])
                info.update(stats)
                info['accent_color'] = get_user_accent_color(info['google_id'])
                del info['google_id']
                self._send_json(info)
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif self.path.startswith('/api/browse-proxy'):
            from urllib.parse import parse_qs, urlparse as _urlparse
            qs = parse_qs(_urlparse(self.path).query)
            url = qs.get('url', [''])[0]
            if not url:
                self._send_json({'error': 'Missing url parameter'}, 400)
                return
            color_scheme = qs.get('scheme', [''])[0] or ''
            try:
                data = cached_fetch(url, timeout=20)
                html_str = data.decode('utf-8', errors='replace')
                cleaned, count = clean_html(html_str, url, color_scheme=color_scheme)
                body = cleaned.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('X-Blocked-Count', str(count))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)
            return

        elif self.path == '/api/adblock-rules':
            self._send_json(get_adblock_stats())
            return

        elif self.path.startswith('/api/image-proxy'):
            from urllib.parse import parse_qs, urlparse as _urlparse
            qs = parse_qs(_urlparse(self.path).query)
            url = qs.get('url', [''])[0]
            if not url:
                self._send_json({'error': 'Missing url parameter'}, 400)
                return
            try:
                body = cached_fetch(url, timeout=15)
                # Guess content type from URL extension
                ext = url.rsplit('.', 1)[-1].lower().split('?')[0] if '.' in url else ''
                ct_map = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                          'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon'}
                ct = ct_map.get(ext, 'image/png')
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'public, max-age=3600')
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)
            return

        elif self.path.startswith('/api/images/'):
            filename = os.path.basename(self.path.split('/')[-1])
            filepath = os.path.join(DIR, 'uploads', filename)
            if not os.path.exists(filepath):
                self.send_response(404)
                self.end_headers()
                return
            with open(filepath, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'public, max-age=31536000')
            self.end_headers()
            self.wfile.write(data)
            return

        else:
            super().do_GET()

    def _get_user(self):
        """Extract google_id from Authorization: Bearer <token> header."""
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            gid = get_session_user(auth[7:])
            if gid:
                touch_last_seen(gid)
            return gid
        return None

    def _check_experiment_access(self, exp_id):
        """Check auth + experiment ownership. Returns google_id or sends error and returns None."""
        if exp_id == '_unstructured':
            return True
        google_id = self._get_user()
        if not google_id:
            self._send_json({'error': 'Not authenticated'}, 401)
            return None
        if not user_can_access_experiment(exp_id, google_id):
            self._send_json({'error': 'Forbidden'}, 403)
            return None
        return google_id

    def do_POST(self):
        global _neuralook_models, _neuralook_screen
        if self.path == '/api/transcribe':
            length = int(self.headers.get('Content-Length', 0))
            if length == 0:
                self._send_json({'error': 'No audio data'}, 400)
                return
            audio_data = self.rfile.read(length)
            try:
                from pywhispercpp.model import Model as WhisperModel
                global _whisper_model
                if _whisper_model is None:
                    _whisper_model = WhisperModel('tiny')
                # Save webm, convert to 16kHz mono wav via ffmpeg
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
                self._send_json({'text': text})
            except Exception as e:
                self._send_json({'error': str(e)}, 500)
            return
        if self.path == '/api/neuralook/save-calibration':
            body = self._read_body()
            calib_path = os.path.join(DIR, 'neuralook_calibration.json')
            try:
                with open(calib_path, 'w') as f:
                    json.dump(body, f)
                self._send_json({'ok': True, 'samples': len(body.get('samples', []))})
            except Exception as e:
                self._send_json({'error': str(e)}, 500)
            return
        if self.path == '/api/neuralook/train':
            body = self._read_body()
            try:
                import torch
                import torch.nn as nn
                import random

                method = body.get('method', 'cnn')  # 'cnn' | 'cnn_headpose'

                # Load calibration from disk (saved during calibration)
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
                    self._send_json({'error': f'Need at least 10 samples, got {len(samples)}'}, 400)
                    return

                # Build tensors — eyeData is flat array of 4096 uint8 (left eye 2048 + right eye 2048)
                eye_size = eye_w * eye_h  # 2048 per eye
                X_list = []
                Y_list = []
                H_list = []  # head pose [yaw, pitch, roll] per sample
                for s in samples:
                    raw = s['eyeData']
                    if len(raw) != eye_size * 2:
                        continue
                    left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                    right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                    X_list.append(torch.cat([left, right], dim=0))  # [2, 32, 64]
                    Y_list.append([s['screenX'] / screen_w, s['screenY'] / screen_h])
                    hp = s.get('headPose', [0, 0, 0])
                    H_list.append(hp if len(hp) == 3 else [0, 0, 0])

                if len(X_list) < 10:
                    self._send_json({'error': f'Only {len(X_list)} valid samples'}, 400)
                    return

                X = torch.stack(X_list)  # [N, 2, 32, 64]
                Y = torch.tensor(Y_list, dtype=torch.float32)  # [N, 2]
                H = torch.tensor(H_list, dtype=torch.float32)  # [N, 3] head pose

                # Train/val split — hold out ~25% of calibration points
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

                # CNN: 2-channel 32x64 eye crops → 2 screen coords
                class GazeCNN(nn.Module):
                    def __init__(self):
                        super().__init__()
                        self.features = nn.Sequential(
                            nn.Conv2d(2, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
                            nn.MaxPool2d(2),  # → [32, 16, 32]
                            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
                            nn.MaxPool2d(2),  # → [64, 8, 16]
                            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
                            nn.AdaptiveAvgPool2d((4, 4)),  # → [128, 4, 4]
                        )
                        self.head = nn.Sequential(
                            nn.Flatten(),
                            nn.Linear(128 * 4 * 4, 256), nn.ReLU(), nn.Dropout(0.3),
                            nn.Linear(256, 64), nn.ReLU(), nn.Dropout(0.3),
                            nn.Linear(64, 2)
                        )
                    def forward(self, x):
                        return self.head(self.features(x))

                # CNN + Head Pose: same conv backbone, head pose concatenated before FC
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
                        # 128*4*4 = 2048 from conv + 3 from head pose
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

                # wandb local logging (offline mode, no account needed)
                wb = None
                try:
                    import wandb
                    wandb.init(
                        project='neuralook',
                        mode='online',
                        config={
                            'architecture': 'GazeCNNHeadPose' if is_headpose else 'GazeCNN',
                            'method': method,
                            'eye_w': eye_w, 'eye_h': eye_h,
                            'n_samples': len(X_list),
                            'n_train': int(train_mask.sum()),
                            'n_val': int(val_mask.sum()),
                            'n_cal_points': len(unique_targets),
                            'n_val_points': n_val_points,
                            'lr': 1e-3, 'weight_decay': 1e-4,
                            'batch_size': batch_size,
                            'max_epochs': max_epochs,
                            'patience': patience,
                            'dropout': 0.3,
                            'screen_w': screen_w, 'screen_h': screen_h,
                        }
                    )
                    wandb.watch(model, log='all', log_freq=50)
                    wb = wandb
                    wb_url = wandb.run.get_url() if wandb.run else None
                except ImportError:
                    wb_url = None
                except Exception:
                    wb_url = None

                # SSE stream for progress
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'keep-alive')
                self.end_headers()

                def _sse(event, data):
                    self.wfile.write(f'event: {event}\ndata: {json.dumps(data)}\n\n'.encode())
                    self.wfile.flush()

                _sse('progress', {'epoch': 0, 'max_epochs': max_epochs, 'phase': 'training', 'val_loss': None})

                # Log setup info
                n_params = sum(p.numel() for p in model.parameters())
                arch_name = 'GazeCNNHeadPose' if is_headpose else 'GazeCNN'
                _sse('log', {'text': f'{arch_name} | params: {n_params:,} | input: [B, 2, {eye_h}, {eye_w}]{" + [B, 3] head pose" if is_headpose else ""}'})
                _sse('log', {'text': f'  features: Conv2d(2→32) → BN → Pool → Conv2d(32→64) → BN → Pool → Conv2d(64→128) → BN → AdaptivePool(4,4)'})
                fc_in = '2048+3' if is_headpose else '2048'
                _sse('log', {'text': f'  head: Flatten → Linear({fc_in},256) → ReLU → Drop(0.3) → Linear(256,64) → ReLU → Drop(0.3) → Linear(64,2)'})
                _sse('log', {'text': f'Adam(lr=1e-3, weight_decay=1e-4) + CosineAnnealingLR(T_max={max_epochs})'})
                _sse('log', {'text': f'train: {int(train_mask.sum())} samples ({len(unique_targets) - n_val_points} points) | val: {int(val_mask.sum())} samples ({n_val_points} points)'})
                _sse('log', {'text': f'batch_size={batch_size} | patience={patience} | max_epochs={max_epochs}'})
                if wb_url:
                    _sse('log', {'text': f'wandb: {wb_url}'})
                    _sse('wandb', {'url': wb_url})
                _sse('log', {'text': ''})
                _sse('log', {'text': f'{"epoch":>6}  {"train_loss":>11}  {"val_loss":>11}  {"lr":>10}  {"best":>5}  {"patience":>8}'})
                _sse('log', {'text': '─' * 65})

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
                        star = '  ★' if improved else ''
                        _sse('log', {'text': f'{epoch:>6}  {last_train_loss:>11.6f}  {val_loss:>11.6f}  {cur_lr:>10.2e}  {"✓" if improved else " ":>5}  {no_improve:>4}/{patience}{star}'})
                        _sse('progress', {'epoch': epoch, 'max_epochs': max_epochs, 'val_loss': round(val_loss, 6), 'train_loss': round(last_train_loss, 6), 'phase': 'training'})
                        if wb:
                            wb.log({'epoch': epoch, 'train_loss': last_train_loss, 'val_loss': val_loss, 'lr': cur_lr, 'best_val_loss': best_val_loss, 'no_improve': no_improve})
                        if no_improve >= patience:
                            _sse('log', {'text': f'\nEarly stopping at epoch {epoch} (no improvement for {patience} epochs)'})
                            stopped_epoch = epoch
                            break
                    stopped_epoch = epoch

                if best_state:
                    model.load_state_dict(best_state)
                    _sse('log', {'text': f'Restored best model (val_loss={best_val_loss:.6f})'})
                model.eval()

                _sse('log', {'text': ''})
                _sse('log', {'text': 'Evaluating on train/val sets...'})
                _sse('progress', {'epoch': stopped_epoch, 'max_epochs': max_epochs, 'phase': 'evaluating'})

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

                _sse('log', {'text': f'  train error: {train_err:.1f}px'})
                _sse('log', {'text': f'  val error:   {val_err:.1f}px'})
                qual = 'Good' if val_err < 80 else 'Fair' if val_err < 150 else 'Poor'
                _sse('log', {'text': f'  quality:     {qual}'})
                _sse('log', {'text': ''})
                _sse('log', {'text': f'Done. Model ready for inference ({n_params:,} params, screen {screen_w}x{screen_h}).'})

                if wb:
                    wb.summary['train_error_px'] = round(train_err, 1)
                    wb.summary['val_error_px'] = round(val_err, 1)
                    wb.summary['stopped_epoch'] = stopped_epoch
                    wb.summary['best_val_loss'] = round(best_val_loss, 6)
                    wb.summary['quality'] = qual
                    wb.finish()
                    _sse('log', {'text': f'wandb: Run logged offline → wandb/latest-run'})

                _sse('done', {
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
                try: _sse('error', {'error': 'PyTorch not installed on server'})
                except Exception: self._send_json({'error': 'PyTorch not installed on server'}, 500)
            except Exception as e:
                import traceback; traceback.print_exc()
                try: _sse('error', {'error': str(e)})
                except Exception: self._send_json({'error': str(e)}, 500)
            return
        if self.path == '/api/neuralook/predict':
            body = self._read_body()
            try:
                import torch

                method = body.get('method', 'cnn')
                model = _neuralook_models.get(method)
                if model is None:
                    self._send_json({'error': f'Model not trained for method: {method}'}, 400)
                    return
                raw = body.get('eyeData', [])
                screen_w, screen_h, eye_w, eye_h = _neuralook_screen
                eye_size = eye_w * eye_h
                if len(raw) != eye_size * 2:
                    self._send_json({'error': f'Expected {eye_size * 2} values, got {len(raw)}'}, 400)
                    return
                left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
                inp = torch.cat([left, right], dim=0).unsqueeze(0)  # [1, 2, 32, 64]
                with torch.no_grad():
                    if method == 'cnn_headpose':
                        hp = body.get('headPose', [0, 0, 0])
                        hp_tensor = torch.tensor([hp], dtype=torch.float32)
                        pred = model(inp, hp_tensor)[0]
                    else:
                        pred = model(inp)[0]
                self._send_json({
                    'x': round(pred[0].item() * screen_w, 1),
                    'y': round(pred[1].item() * screen_h, 1)
                })
            except Exception as e:
                self._send_json({'error': str(e)}, 500)
            return
        if self.path == '/api/vibe/git':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            cmd = body.get('cmd', '')
            user_vault = _get_user_vault_path(google_id)
            ALLOWED = {'status', 'files', 'branches', 'log', 'stash', 'diff', 'show', 'reflog'}
            if cmd not in ALLOWED:
                self._send_json({'error': 'Command not allowed'}, 400)
                return
            try:
                result = _vibe_run_git(cmd, body, user_vault)
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 500)
            return
        if self.path == '/api/auth/google':
            body = self._read_body()
            credential = body.get('credential', '')
            if not credential:
                self._send_json({'error': 'Missing credential'}, 400)
                return
            # Verify Google ID token
            try:
                verify_url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + credential
                req = urllib.request.Request(verify_url)
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                    token_info = json.loads(resp.read())
                if token_info.get('aud') != GOOGLE_CLIENT_ID:
                    self._send_json({'error': 'Invalid token audience'}, 401)
                    return
                # Also decode JWT payload directly for picture claim
                import base64
                parts = credential.split('.')
                payload_b64 = parts[1] + '=' * (4 - len(parts[1]) % 4)
                jwt_payload = json.loads(base64.urlsafe_b64decode(payload_b64))
                google_id = token_info.get('sub')
                email = token_info.get('email', '')
                name = token_info.get('name', '') or jwt_payload.get('name', '')
                picture = token_info.get('picture', '') or jwt_payload.get('picture', '')
                if not google_id:
                    self._send_json({'error': 'Invalid token'}, 401)
                    return
            except Exception as e:
                self._send_json({'error': f'Token verification failed: {e}'}, 401)
                return
            upsert_google_user(google_id, email, name, picture)
            token = create_session(google_id)
            info = get_user_info(google_id)
            username = info['username'] if info else None
            self._send_json({'token': token, 'email': email, 'name': name, 'username': username, 'picture': picture})
            return

        elif self.path == '/api/auth/logout':
            auth = self.headers.get('Authorization', '')
            if auth.startswith('Bearer '):
                delete_session(auth[7:])
            self._send_json({'ok': True})
            return

        elif self.path == '/api/auth/username':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            username = (body.get('username') or '').strip()
            if not username or len(username) < 2 or len(username) > 20:
                self._send_json({'error': 'Username must be 2-20 characters'}, 400)
                return
            if not re.match(r'^[a-zA-Z0-9_-]+$', username):
                self._send_json({'error': 'Only letters, numbers, hyphens, and underscores'}, 400)
                return
            if set_username(google_id, username):
                self._send_json({'ok': True, 'username': username})
            else:
                self._send_json({'error': 'Username already taken'}, 409)
            return

        elif self.path == '/api/auth/delete-account':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            owned_exps = delete_user(google_id)
            # Delete owned experiment directories from disk
            for exp_id in owned_exps:
                exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
                if os.path.isdir(exp_dir):
                    _kill_kernel(exp_id)
                    shutil.rmtree(exp_dir)
            # Clear unstructured files
            unstructured = os.path.join(EXPERIMENTS_DIR, '_unstructured')
            if os.path.isdir(unstructured):
                for f in os.listdir(unstructured):
                    if f == 'meta.json':
                        continue
                    fpath = os.path.join(unstructured, f)
                    if os.path.isfile(fpath):
                        os.remove(fpath)
                    elif os.path.isdir(fpath):
                        shutil.rmtree(fpath)
            self._send_json({'ok': True})
            return

        elif self.path == '/api/teams':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            name = (body.get('name') or '').strip()
            if not name:
                self._send_json({'error': 'Team name required'}, 400)
                return
            private = bool(body.get('private', False))
            parent_id = body.get('parent_id')
            if parent_id is not None:
                parent_id = int(parent_id)
            team_id = create_team(name, google_id, private=private, parent_id=parent_id)
            self._send_json({'ok': True, 'id': team_id})
            return

        elif m := self._match(r'^/api/teams/(\d+)/invite$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            username = (body.get('username') or '').strip()
            if not username:
                self._send_json({'error': 'Username required'}, 400)
                return
            result = invite_to_team(int(m.group(1)), google_id, username)
            if 'error' in result:
                self._send_json(result, 400)
            else:
                self._send_json(result)
            return

        elif m := self._match(r'^/api/teams/(\d+)/remove$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            target = body.get('google_id', '')
            if not target:
                self._send_json({'error': 'google_id required'}, 400)
                return
            if remove_team_member(int(m.group(1)), google_id, target):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not allowed'}, 403)
            return

        elif m := self._match(r'^/api/inbox/(\d+)/respond$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            accept = body.get('accept', False)
            if respond_to_invite(int(m.group(1)), google_id, accept):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found or not yours'}, 404)
            return

        elif self.path == '/api/sync':
            username = self._get_user()
            if not username:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            client_data = body.get('data', {})
            # Merge: for each key, keep the entry with the latest 'updated' timestamp
            server_data = get_all_user_data(username)
            to_save = {}
            merged = {}
            for key in set(list(client_data.keys()) + list(server_data.keys())):
                c = client_data.get(key)
                s = server_data.get(key)
                if c and s:
                    if c.get('updated', 0) >= s.get('updated', 0):
                        to_save[key] = c
                        merged[key] = c
                    else:
                        merged[key] = s
                elif c:
                    to_save[key] = c
                    merged[key] = c
                else:
                    merged[key] = s
            if to_save:
                set_user_data_bulk(username, to_save)
            self._send_json({'data': merged})
            return

        elif self.path == '/api/citations':
            try:
                body = self._read_body()
                arxiv_ids = body.get('ids', [])
                if not arxiv_ids:
                    self._send_json({'error': 'ids required'}, 400)
                    return
                paper_ids = [f'ArXiv:{aid}' for aid in arxiv_ids]
                payload = json.dumps({'ids': paper_ids}).encode()
                req = urllib.request.Request(
                    'https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,externalIds',
                    data=payload,
                    headers={
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0'
                    },
                    method='POST'
                )
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                    data = json.loads(resp.read())
                result = {}
                for item in data:
                    if item and item.get('externalIds', {}).get('ArXiv'):
                        aid = item['externalIds']['ArXiv']
                        result[aid] = item.get('citationCount', 0)
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/runs$'):
            exp_id = m.group(1)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            name = body.get('name', '').strip()
            if not name:
                self._send_json({'error': 'Name required'}, 400)
                return
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
            self._send_json(run, 201)

        elif self.path == '/api/extract-text':
            try:
                body = self._read_body()
                url = body.get('url', '').strip()
                if not url:
                    self._send_json({'error': 'url required'}, 400)
                    return
                if url in _extract_cache:
                    self._send_json(_extract_cache[url])
                    return
                is_arxiv = 'arxiv.org' in url
                if is_arxiv:
                    pdf_url = url.replace('/abs/', '/pdf/')
                    if not pdf_url.endswith('.pdf'):
                        pdf_url += '.pdf'
                    req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                        pdf_bytes = resp.read()
                    import fitz
                    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
                    tmp.write(pdf_bytes)
                    tmp.close()
                    try:
                        doc = fitz.open(tmp.name)
                        pages = []
                        for page_num in range(len(doc)):
                            page = doc[page_num]
                            page_text = page.get_text()
                            pages.append(page_text)
                        doc.close()
                    finally:
                        os.unlink(tmp.name)
                    result = {'text': '\n\n---\n\n'.join(pages), 'pages': len(pages)}
                else:
                    from html.parser import HTMLParser
                    html_bytes = cached_fetch(url, timeout=30)
                    html_str = html_bytes.decode('utf-8', errors='replace')
                    class TextExtractor(HTMLParser):
                        def __init__(self):
                            super().__init__()
                            self.parts = []
                            self._skip = False
                        def handle_starttag(self, tag, attrs):
                            if tag in ('script', 'style', 'noscript'):
                                self._skip = True
                        def handle_endtag(self, tag):
                            if tag in ('script', 'style', 'noscript'):
                                self._skip = False
                        def handle_data(self, data):
                            if not self._skip:
                                t = data.strip()
                                if t:
                                    self.parts.append(t)
                    extractor = TextExtractor()
                    extractor.feed(html_str)
                    text = '\n'.join(extractor.parts)
                    result = {'text': text, 'pages': 1}
                _extract_cache[url] = result
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/extract-links':
            try:
                body = self._read_body()
                url = body.get('url', '').strip()
                if not url:
                    self._send_json({'error': 'url required'}, 400)
                    return
                from html.parser import HTMLParser
                import urllib.parse as urlparse
                html_bytes = cached_fetch(url, timeout=30)
                html_str = html_bytes.decode('utf-8', errors='replace')
                class LinkExtractor(HTMLParser):
                    def __init__(self):
                        super().__init__()
                        self.links = []
                        self._current_tag = None
                        self._current_href = None
                        self._current_text = ''
                    def handle_starttag(self, tag, attrs):
                        if tag == 'a':
                            self._current_tag = 'a'
                            self._current_text = ''
                            href = dict(attrs).get('href', '')
                            if href:
                                self._current_href = urlparse.urljoin(url, href)
                            else:
                                self._current_href = None
                    def handle_endtag(self, tag):
                        if tag == 'a' and self._current_href:
                            text = self._current_text.strip()
                            if text and self._current_href.startswith('http'):
                                self.links.append({'text': text, 'url': self._current_href})
                            self._current_tag = None
                            self._current_href = None
                            self._current_text = ''
                    def handle_data(self, data):
                        if self._current_tag == 'a':
                            self._current_text += data
                extractor = LinkExtractor()
                extractor.feed(html_str)
                # Deduplicate by URL
                seen = set()
                unique = []
                for link in extractor.links:
                    if link['url'] not in seen:
                        seen.add(link['url'])
                        unique.append(link)
                self._send_json({'links': unique})
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/paper-insights':
            try:
                body = self._read_body()
                url = body.get('url', '').strip()
                if not url:
                    self._send_json({'error': 'url required'}, 400)
                    return
                allow_heuristics = body.get('allowHeuristics', True)
                _cache_key = url + ('::h' if allow_heuristics else '::noh')
                # Cache read disabled for dev - always fetch fresh

                # Reuse extract-text logic to get document text
                if url in _extract_cache:
                    text = _extract_cache[url]['text']
                else:
                    # Trigger extraction inline
                    is_arxiv = 'arxiv.org' in url
                    if is_arxiv:
                        pdf_url = url.replace('/abs/', '/pdf/')
                        if not pdf_url.endswith('.pdf'):
                            pdf_url += '.pdf'
                        req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
                        ctx = ssl._create_unverified_context()
                        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                            pdf_bytes = resp.read()
                        import fitz
                        tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
                        tmp.write(pdf_bytes)
                        tmp.close()
                        try:
                            doc = fitz.open(tmp.name)
                            pages = []
                            for page_num in range(len(doc)):
                                pages.append(doc[page_num].get_text())
                            doc.close()
                        finally:
                            os.unlink(tmp.name)
                        text = '\n\n---\n\n'.join(pages)
                        _extract_cache[url] = {'text': text, 'pages': len(pages)}
                    else:
                        from html.parser import HTMLParser
                        html_bytes = cached_fetch(url, timeout=30)
                        html_str = html_bytes.decode('utf-8', errors='replace')
                        class TextExtractor(HTMLParser):
                            def __init__(self):
                                super().__init__()
                                self.parts = []
                                self._skip = False
                            def handle_starttag(self, tag, attrs):
                                if tag in ('script', 'style', 'noscript'):
                                    self._skip = True
                            def handle_endtag(self, tag):
                                if tag in ('script', 'style', 'noscript'):
                                    self._skip = False
                            def handle_data(self, data):
                                if not self._skip:
                                    t = data.strip()
                                    if t:
                                        self.parts.append(t)
                        extractor = TextExtractor()
                        extractor.feed(html_str)
                        text = '\n'.join(extractor.parts)
                        _extract_cache[url] = {'text': text, 'pages': 1}

                # 0. Extract authors from Semantic Scholar (includes stats)
                authors = []
                arxiv_match = re.search(r'(\d{4}\.\d{4,5})', url)
                if arxiv_match:
                    arxiv_id = arxiv_match.group(1)
                    cache_key = f'authors:{arxiv_id}'
                    now = time.time()
                    # Check cache first
                    if cache_key in _s2_cache and (now - _s2_cache[cache_key]['ts']) < _S2_CACHE_TTL:
                        authors = _s2_cache[cache_key]['data']
                        print(f'[paper-insights] Using cached author data for {arxiv_id}')
                    else:
                        try:
                            # First get paper with author IDs
                            s2_url = f'https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}?fields=authors.authorId,authors.name,authors.affiliations'
                            s2_req = urllib.request.Request(s2_url, headers={'User-Agent': 'Mozilla/5.0'})
                            ctx = ssl._create_unverified_context()
                            with urllib.request.urlopen(s2_req, timeout=10, context=ctx) as s2_resp:
                                s2_data = json.loads(s2_resp.read())
                            print(f'[paper-insights] S2 paper authors: {len(s2_data.get("authors", []))} authors')
                            if 'authors' in s2_data:
                                # Collect author IDs for batch lookup (limit to first 10)
                                author_ids = []
                                basic_authors = []
                                for a in s2_data['authors'][:10]:
                                    author_info = {'name': a.get('name', '')}
                                    if a.get('authorId'):
                                        author_info['authorId'] = a['authorId']
                                        author_ids.append(a['authorId'])
                                    if a.get('affiliations'):
                                        author_info['affiliation'] = a['affiliations'][0] if isinstance(a['affiliations'], list) else a['affiliations']
                                    basic_authors.append(author_info)

                                # Batch fetch author details if we have IDs
                                if author_ids:
                                    try:
                                        batch_url = 'https://api.semanticscholar.org/graph/v1/author/batch'
                                        batch_body = json.dumps({'ids': author_ids}).encode('utf-8')
                                        batch_req = urllib.request.Request(
                                            f'{batch_url}?fields=authorId,hIndex,paperCount,citationCount',
                                            data=batch_body,
                                            headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'},
                                            method='POST'
                                        )
                                        with urllib.request.urlopen(batch_req, timeout=10, context=ctx) as batch_resp:
                                            author_details = json.loads(batch_resp.read())
                                        print(f'[paper-insights] S2 author details sample: {author_details[:1] if author_details else "none"}')
                                        # Create lookup by authorId
                                        details_map = {d['authorId']: d for d in author_details if d and d.get('authorId')}
                                        # Merge details into basic_authors
                                        for author_info in basic_authors:
                                            aid = author_info.get('authorId')
                                            if aid and aid in details_map:
                                                d = details_map[aid]
                                                if d.get('hIndex'):
                                                    author_info['hIndex'] = d['hIndex']
                                                if d.get('paperCount'):
                                                    author_info['paperCount'] = d['paperCount']
                                                if d.get('citationCount'):
                                                    author_info['citationCount'] = d['citationCount']
                                    except Exception as e2:
                                        print(f'[paper-insights] S2 author batch fetch failed: {e2}')

                                authors = basic_authors
                                # Cache the result
                                _s2_cache[cache_key] = {'data': authors, 'ts': now}
                        except Exception as e:
                            print(f'[paper-insights] Semantic Scholar author fetch failed: {e}')
                    # Fallback to arXiv API for just names (only if S2 failed)
                    if not authors:
                        try:
                            api_url = f'https://export.arxiv.org/api/query?id_list={arxiv_id}'
                            api_req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
                            ctx = ssl._create_unverified_context()
                            with urllib.request.urlopen(api_req, timeout=15, context=ctx) as api_resp:
                                api_xml = api_resp.read().decode('utf-8')
                            import xml.etree.ElementTree as ET
                            root = ET.fromstring(api_xml)
                            ns = {'atom': 'http://www.w3.org/2005/Atom'}
                            for entry in root.findall('atom:entry', ns):
                                for author_el in entry.findall('atom:author', ns):
                                    name_el = author_el.find('atom:name', ns)
                                    if name_el is not None and name_el.text:
                                        authors.append({'name': name_el.text.strip()})
                        except Exception:
                            pass

                # 1. Extract repo URLs (heuristic — regex)
                repos = []
                if allow_heuristics:
                    repo_pattern = re.compile(
                        r'https?://(?:github\.com|gitlab\.com|huggingface\.co|bitbucket\.org)'
                        r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_./-]*)?'
                    )
                    context_pattern = re.compile(
                        r'(?:code|implementation|source|repository|available|released|open[- ]?source)[^.]*?(https?://(?:github\.com|gitlab\.com|huggingface\.co|bitbucket\.org)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)',
                        re.IGNORECASE
                    )
                    raw_urls = repo_pattern.findall(text)
                    seen = {}
                    for u in raw_urls:
                        u = u.rstrip('/')
                        u = re.sub(r'[.,;:)\]]+$', '', u)
                        parts = u.split('/')
                        if len(parts) >= 5:
                            base = '/'.join(parts[:5])
                        else:
                            base = u
                        if base not in seen:
                            seen[base] = u
                            repos.append({'url': base, 'context': ''})
                    context_matches = context_pattern.findall(text)
                    for cm in context_matches:
                        cm_base = '/'.join(cm.rstrip('/').split('/')[:5])
                        for r in repos:
                            if r['url'] == cm_base and not r['context']:
                                r['context'] = 'Code repository'

                # 2. Extract key insights via LLM (Ollama qwen2.5:3b)
                normalized = re.sub(r'(?<![.!?\n])\n(?![A-Z\n])', ' ', text)
                normalized = re.sub(r'  +', ' ', normalized)
                sentences = re.split(r'(?<=[.!?])\s+', normalized)
                truncated_text = text[:10000]
                insights = []
                try:
                    insight_prompt = (
                        "You are a research paper analyzer. Read the document text below and extract "
                        "the most important insights. For each insight, provide a category label and "
                        "quote the EXACT sentence or passage from the text (do not paraphrase).\n\n"
                        "Categories: Contribution, Result, Method, Surprising, Design\n\n"
                        "Respond ONLY with a JSON array. Each element: {\"label\": \"Category\", \"text\": \"exact quote from paper\"}\n"
                        "Return 3-5 insights. Only use categories from the list above.\n"
                        "If you cannot find insights for a category, skip it.\n\n"
                        "--- DOCUMENT TEXT ---\n" + truncated_text + "\n--- END ---"
                    )
                    llm_payload = json.dumps({
                        "model": "qwen2.5:3b",
                        "messages": [{"role": "user", "content": insight_prompt}],
                        "stream": False,
                        "options": {"temperature": 0, "num_predict": 1500}
                    }).encode()
                    llm_req = urllib.request.Request(
                        "http://localhost:11434/api/chat",
                        data=llm_payload,
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(llm_req, timeout=60) as llm_resp:
                        llm_data = json.loads(llm_resp.read())
                    raw_content = llm_data.get("message", {}).get("content", "").strip()
                    # Parse JSON from response (handle markdown code fences)
                    json_str = raw_content
                    if '```' in json_str:
                        json_str = re.sub(r'```(?:json)?\s*', '', json_str)
                        json_str = json_str.replace('```', '')
                    json_str = json_str.strip()
                    parsed_insights = json.loads(json_str)
                    valid_labels = {'Contribution', 'Result', 'Method', 'Surprising', 'Design'}
                    if isinstance(parsed_insights, list):
                        for item in parsed_insights[:5]:
                            if isinstance(item, dict) and 'label' in item and 'text' in item:
                                label = item['label']
                                if label in valid_labels:
                                    insights.append({'label': label, 'text': item['text'][:300]})
                except Exception as llm_err:
                    print(f"[insights] LLM extraction failed: {llm_err}")
                    if allow_heuristics:
                        print("[insights] Falling back to keyword matching")
                        fallback_phrases = {
                            'Contribution': ['we propose', 'we introduce', 'we present', 'this paper presents'],
                            'Result': ['we show that', 'we achieve', 'outperforms', 'state-of-the-art'],
                            'Method': ['our method', 'our approach', 'our framework', 'we train'],
                        }
                        used_sentences = set()
                        for category, phrases in fallback_phrases.items():
                            for s in sentences:
                                s_clean = ' '.join(s.split())
                                if len(s_clean) < 40:
                                    continue
                                if any(p in s_clean.lower() for p in phrases) and s_clean not in used_sentences:
                                    trimmed = s_clean[:300]
                                    if len(s_clean) > 300:
                                        trimmed = trimmed.rsplit(' ', 1)[0] + '...'
                                    insights.append({'label': category, 'text': trimmed})
                                    used_sentences.add(s_clean)
                                    break

                # 3. Extract GPU/hardware info (heuristic — regex)
                if allow_heuristics:
                    gpu_pattern = re.compile(
                        r'(?:NVIDIA|AMD|Intel)?\s*(?:A100|H100|V100|A6000|A40|RTX\s*\d{4}\s*(?:Ti)?|'
                        r'P100|T4|K80|TPU\s*v\d|MI\d{3}|GeForce|Titan|3090|4090|A10G)',
                        re.IGNORECASE
                    )
                    gpu_matches = gpu_pattern.findall(normalized)
                    if gpu_matches:
                        seen_gpus = set()
                        unique_gpus = []
                        for g in gpu_matches:
                            g_clean = ' '.join(g.split())
                            if g_clean.lower() not in seen_gpus:
                                seen_gpus.add(g_clean.lower())
                                unique_gpus.append(g_clean)
                        gpu_sentence = ''
                        for s in sentences:
                            s_clean = ' '.join(s.split())
                            if gpu_pattern.search(s_clean) and len(s_clean) >= 30:
                                gpu_sentence = s_clean[:300]
                                if len(s_clean) > 300:
                                    gpu_sentence = gpu_sentence.rsplit(' ', 1)[0] + '...'
                                break
                        insights.append({
                            'label': 'Hardware',
                            'text': gpu_sentence or ('Trained on: ' + ', '.join(unique_gpus)),
                            'gpus': unique_gpus,
                        })

                result = {'repos': repos, 'insights': insights, 'authors': authors}
                _insights_cache[_cache_key] = result
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/author-details':
            try:
                body = self._read_body()
                author_id = body.get('authorId', '').strip()
                if not author_id:
                    self._send_json({'error': 'authorId required'}, 400)
                    return
                # Fetch author details from Semantic Scholar
                s2_url = f'https://api.semanticscholar.org/graph/v1/author/{author_id}?fields=name,affiliations,homepage,hIndex,citationCount,paperCount,url'
                s2_req = urllib.request.Request(s2_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(s2_req, timeout=15) as s2_resp:
                    author_data = json.loads(s2_resp.read())
                # Fetch author's top papers
                papers_url = f'https://api.semanticscholar.org/graph/v1/author/{author_id}/papers?fields=title,year,citationCount,url,venue&limit=10'
                papers_req = urllib.request.Request(papers_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(papers_req, timeout=15) as papers_resp:
                    papers_data = json.loads(papers_resp.read())
                # Sort papers by citation count
                papers = papers_data.get('data', [])
                papers.sort(key=lambda p: p.get('citationCount', 0) or 0, reverse=True)
                result = {
                    'name': author_data.get('name', ''),
                    'affiliations': author_data.get('affiliations', []),
                    'homepage': author_data.get('homepage'),
                    'hIndex': author_data.get('hIndex'),
                    'citationCount': author_data.get('citationCount'),
                    'paperCount': author_data.get('paperCount'),
                    'url': author_data.get('url'),
                    'papers': papers[:10]
                }
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/citation-lookup':
            # Look up a paper by title on Semantic Scholar
            try:
                body = self._read_body()
                query = body.get('query', '').strip()
                if not query:
                    self._send_json({'error': 'query required'}, 400)
                    return
                # Search Semantic Scholar
                search_url = f'https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.request.quote(query)}&limit=1&fields=title,authors,year,abstract,citationCount,url,venue,externalIds'
                req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                    data = json.loads(resp.read())
                papers = data.get('data', [])
                if not papers:
                    self._send_json({'error': 'not found'}, 404)
                    return
                paper = papers[0]
                result = {
                    'title': paper.get('title', ''),
                    'authors': [a.get('name', '') for a in paper.get('authors', [])[:5]],
                    'year': paper.get('year'),
                    'abstract': paper.get('abstract', '')[:500] if paper.get('abstract') else None,
                    'citationCount': paper.get('citationCount'),
                    'venue': paper.get('venue'),
                    'url': paper.get('url'),
                    'arxivId': paper.get('externalIds', {}).get('ArXiv'),
                }
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/paper-references':
            # Get references for a paper by arXiv ID
            try:
                body = self._read_body()
                arxiv_id = body.get('arxivId', '').strip()
                ref_num = body.get('refNum')  # Optional - if provided, return single ref
                if not arxiv_id:
                    self._send_json({'error': 'arxivId required'}, 400)
                    return

                # Check persistent SQLite cache first (references don't change)
                references = get_cached_references(arxiv_id)
                if references is None:
                    # Fetch paper references from Semantic Scholar
                    api_url = f'https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}?fields=references.title,references.authors,references.year,references.abstract,references.citationCount,references.url,references.venue,references.externalIds'
                    req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                        data = json.loads(resp.read())
                    references = data.get('references', [])
                    # Persist to SQLite (permanent — references don't change)
                    set_cached_references(arxiv_id, references)
                if not references:
                    self._send_json({'error': 'no references found'}, 404)
                    return

                # If ref_num provided, return single reference
                if ref_num is not None and ref_num >= 1:
                    ref_index = ref_num - 1
                    if ref_index < 0 or ref_index >= len(references):
                        self._send_json({'error': f'reference {ref_num} not found (paper has {len(references)} references)'}, 404)
                        return

                    ref = references[ref_index]
                    if not ref:
                        self._send_json({'error': f'reference {ref_num} has no data'}, 404)
                        return

                    result = {
                        'title': ref.get('title', ''),
                        'authors': [a.get('name', '') for a in ref.get('authors', [])[:5]] if ref.get('authors') else [],
                        'year': ref.get('year'),
                        'abstract': ref.get('abstract', '')[:500] if ref.get('abstract') else None,
                        'citationCount': ref.get('citationCount'),
                        'venue': ref.get('venue'),
                        'url': ref.get('url'),
                        'arxivId': ref.get('externalIds', {}).get('ArXiv') if ref.get('externalIds') else None,
                    }
                    self._send_json(result)
                    return

                # Return all references (compact format for listing)
                result = []
                for i, ref in enumerate(references):
                    if ref:
                        result.append({
                            'num': i + 1,
                            'title': ref.get('title', ''),
                            'authors': [a.get('name', '') for a in ref.get('authors', [])[:3]] if ref.get('authors') else [],
                            'year': ref.get('year'),
                            'citationCount': ref.get('citationCount'),
                        })
                self._send_json({'references': result, 'total': len(references)})
            except urllib.error.HTTPError as e:
                self._send_json({'error': f'Semantic Scholar API error: {e.code}'}, 502)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/author-lookup':
            # Look up an author on Semantic Scholar (cached in SQLite, stats refreshed daily)
            try:
                body = self._read_body()
                query = body.get('query', '').strip()
                if not query:
                    self._send_json({'error': 'query required'}, 400)
                    return

                cached, needs_refresh = get_cached_author(query)

                if cached and not needs_refresh:
                    # Fresh cache hit — return immediately
                    self._send_json(cached)
                    return

                # Try to fetch from API (fresh fetch or stale refresh)
                try:
                    search_url = f'https://api.semanticscholar.org/graph/v1/author/search?query={urllib.request.quote(query)}&limit=1&fields=name,affiliations,paperCount,citationCount,hIndex,url'
                    req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                        data = json.loads(resp.read())
                    authors = data.get('data', [])
                    if not authors:
                        if cached:
                            # API returned nothing but we have stale data — use it
                            self._send_json(cached)
                            return
                        self._send_json({'error': 'not found'}, 404)
                        return
                    author = authors[0]
                    # Fetch top papers
                    author_id = author.get('authorId')
                    top_papers = []
                    if author_id:
                        try:
                            papers_url = f'https://api.semanticscholar.org/graph/v1/author/{author_id}/papers?fields=title,year,citationCount&limit=3&sort=citationCount:desc'
                            req2 = urllib.request.Request(papers_url, headers={'User-Agent': 'Mozilla/5.0'})
                            with urllib.request.urlopen(req2, timeout=10, context=ctx) as resp2:
                                papers_data = json.loads(resp2.read())
                            top_papers = [{'title': p.get('title',''), 'year': p.get('year'), 'citationCount': p.get('citationCount',0)} for p in papers_data.get('data', [])[:3]]
                        except Exception:
                            # If paper fetch fails, keep top papers from cache if available
                            if cached and cached.get('topPapers'):
                                top_papers = cached['topPapers']
                    result = {
                        'authorId': author.get('authorId'),
                        'name': author.get('name', ''),
                        'affiliations': author.get('affiliations', []),
                        'paperCount': author.get('paperCount'),
                        'citationCount': author.get('citationCount'),
                        'hIndex': author.get('hIndex'),
                        'url': author.get('url'),
                        'topPapers': top_papers,
                    }
                    # Persist to SQLite
                    set_cached_author(query, result)
                    self._send_json(result)
                except Exception:
                    if cached:
                        # API failed but we have stale data — serve it
                        self._send_json(cached)
                    else:
                        raise
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/images':
            try:
                body = self._read_body()
                image_b64 = body.get('image', '')
                if not image_b64:
                    self._send_json({'error': 'image required'}, 400)
                    return
                import base64
                uploads_dir = os.path.join(DIR, 'uploads')
                os.makedirs(uploads_dir, exist_ok=True)
                filename = str(uuid.uuid4()) + '.png'
                filepath = os.path.join(uploads_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_b64))
                self._send_json({'url': '/api/images/' + filename})
            except Exception as e:
                self._send_json({'error': str(e)}, 500)

        elif self.path == '/api/doc-chat':
            try:
                body = self._read_body()
                context = body.get('context', '')
                messages = body.get('messages', [])
                is_vision = body.get('vision', False)
                client_model = body.get('model', '')
                tools_enabled = body.get('tools', False)
                if not messages:
                    self._send_json({'error': 'messages required'}, 400)
                    return
                try:
                    from persistence import log_usage
                    log_usage('lookup_chat')
                except: pass

                if is_vision:
                    model = client_model or "qwen3-vl:8b"
                    tools_enabled = False  # no tools in vision mode
                    system_msg = (
                        "You are a helpful visual analysis assistant. The user has taken a screenshot "
                        "and wants to ask about it. Describe what you see and answer their questions "
                        "based on the visual content provided."
                    )
                    ollama_messages = [{"role": "system", "content": system_msg}]
                    for m in messages:
                        msg = {"role": m["role"], "content": m.get("content", "")}
                        if m.get("images"):
                            msg["images"] = m["images"]
                        ollama_messages.append(msg)
                else:
                    model = client_model or ("qwen3:8b" if tools_enabled else "qwen2.5:3b")
                    truncated_ctx = context[:12000] if context else ''
                    # Build page context string for tools
                    page_ctx = ''
                    if tools_enabled:
                        page_url = body.get('pageUrl', '')
                        page_title = body.get('pageTitle', '')
                        if page_url:
                            page_ctx = f'\n\nThe user is currently viewing: "{page_title}" ({page_url}). Use this when they refer to "this page", "this paper", etc.'
                    if truncated_ctx:
                        system_msg = (
                            "You are a helpful research assistant. The user is reading a document. "
                            "Answer their questions based on the document text below when relevant. "
                            "You also have tools available to search the web, find papers, fetch pages, "
                            "bookmark posts, navigate the app, and create experiments." + page_ctx + "\n\n"
                            "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
                        ) if tools_enabled else (
                            "You are a helpful research assistant. The user is reading a document. "
                            "Answer their questions based ONLY on the document text below. "
                            "Do not make up information that is not in the document.\n\n"
                            "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
                        )
                    else:
                        system_msg = (
                            "You are a helpful assistant with tools to search the web, find papers, "
                            "fetch page content, bookmark posts, navigate the app, and create experiments. "
                            "Use tools when they would help answer the user's question." + page_ctx
                        ) if tools_enabled else "You are a helpful assistant."
                    ollama_messages = [{"role": "system", "content": system_msg}] + messages

                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'keep-alive')
                self.end_headers()
                try:
                    # Tool call loop (max 5 iterations)
                    if tools_enabled:
                        for _ in range(5):
                            payload = json.dumps({
                                "model": model,
                                "messages": ollama_messages,
                                "tools": CHAT_TOOLS,
                                "stream": False
                            }).encode()
                            req = urllib.request.Request(
                                "http://localhost:11434/api/chat",
                                data=payload,
                                headers={"Content-Type": "application/json"}
                            )
                            with urllib.request.urlopen(req, timeout=120) as resp:
                                result = json.loads(resp.read())
                            msg = result.get("message", {})
                            tool_calls = msg.get("tool_calls")
                            if not tool_calls:
                                # No tool calls — model produced text, break to stream
                                break
                            # Process each tool call
                            ollama_messages.append(msg)
                            for tc in tool_calls:
                                fn = tc.get("function", {})
                                tool_name = fn.get("name", "")
                                tool_args = fn.get("arguments", {})
                                # Send status event to frontend
                                self.wfile.write(f'event: tool_call\ndata: {json.dumps({"name": tool_name, "args": tool_args})}\n\n'.encode())
                                self.wfile.flush()
                                try:
                                    from persistence import log_usage
                                    log_usage('tool_call')
                                except: pass
                                # Execute tool
                                tool_result = self._execute_chat_tool(tool_name, tool_args)
                                ollama_messages.append({"role": "tool", "content": json.dumps(tool_result)})
                        else:
                            # Exhausted iterations — do final call without tools
                            pass

                    # Final streaming call
                    payload = json.dumps({
                        "model": model,
                        "messages": ollama_messages,
                        "stream": True
                    }).encode()
                    req = urllib.request.Request(
                        "http://localhost:11434/api/chat",
                        data=payload,
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        final_chunk = None
                        for line in resp:
                            chunk = json.loads(line)
                            token = chunk.get("message", {}).get("content", "")
                            if token:
                                self.wfile.write(f'event: token\ndata: {json.dumps(token)}\n\n'.encode())
                                self.wfile.flush()
                            if chunk.get("done"):
                                final_chunk = chunk
                                break
                    # Send usage stats from Ollama's final chunk
                    usage = {}
                    if final_chunk:
                        if "prompt_eval_count" in final_chunk:
                            usage["prompt_tokens"] = final_chunk["prompt_eval_count"]
                        if "eval_count" in final_chunk:
                            usage["completion_tokens"] = final_chunk["eval_count"]
                        if "total_duration" in final_chunk:
                            usage["duration_ms"] = round(final_chunk["total_duration"] / 1e6)
                        if "eval_duration" in final_chunk:
                            usage["eval_ms"] = round(final_chunk["eval_duration"] / 1e6)
                        if "model" in final_chunk:
                            usage["model"] = final_chunk["model"]
                    if usage:
                        self.wfile.write(f'event: usage\ndata: {json.dumps(usage)}\n\n'.encode())
                        self.wfile.flush()
                    self.wfile.write(b'event: done\ndata: {}\n\n')
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            except Exception as e:
                try:
                    self.wfile.write(f'event: error\ndata: {json.dumps(str(e))}\n\n'.encode())
                    self.wfile.flush()
                except Exception:
                    pass

        elif self.path == '/api/quality-filter':
            try:
                body = self._read_body()
                titles = body.get('titles', [])
                mode = body.get('mode', 'verdict')  # 'verdict' or 'score'
                if not titles:
                    self._send_json({'error': 'titles required'}, 400)
                    return

                if mode == 'score':
                    # Phase 2: score only (called for kept titles)
                    score_system = DEFAULT_SCORING_PROMPT
                    def score_title(title):
                        payload = json.dumps({
                            "model": "qwen2.5:7b",
                            "messages": [
                                {"role": "system", "content": score_system},
                                {"role": "user", "content": title}
                            ],
                            "stream": False,
                            "options": {"temperature": 0, "num_predict": 8}
                        }).encode()
                        req = urllib.request.Request(
                            "http://localhost:11434/api/chat",
                            data=payload,
                            headers={"Content-Type": "application/json"}
                        )
                        with urllib.request.urlopen(req, timeout=30) as resp:
                            resp_data = json.loads(resp.read())
                        raw = resp_data.get("message", {}).get("content", "").strip()
                        score_match = re.search(r'\d+', raw)
                        score = int(score_match.group()) if score_match else 5
                        return max(0, min(100, score))

                    results = {}
                    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                        futures = {pool.submit(score_title, t): t for t in titles}
                        for fut in concurrent.futures.as_completed(futures):
                            t = futures[fut]
                            try:
                                results[t] = fut.result()
                            except Exception:
                                results[t] = 50
                    self._send_json(results)
                else:
                    # Phase 1: verdict only (KEEP or SKIP)
                    custom_prompt = body.get('prompt', '')
                    system_msg = custom_prompt.strip() if custom_prompt.strip() else None

                    results = {}
                    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                        futures = {pool.submit(classify_title, t, system_msg): t for t in titles}
                        for fut in concurrent.futures.as_completed(futures):
                            t = futures[fut]
                            try:
                                results[t] = fut.result()
                            except Exception:
                                results[t] = "keep"
                    self._send_json(results)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/panel-suggest':
            try:
                body = self._read_body()
                text = body.get('text', '').strip()
                if not text or len(text) < 3:
                    self._send_json({'suggestion': ''})
                    return
                snippet = text[:300]
                payload = json.dumps({
                    "model": "qwen3:0.6b",
                    "messages": [
                        {"role": "system", "content": "Given some text the user selected or is looking at, suggest ONE short question (under 12 words) they might want to ask about it. Return ONLY the question, nothing else. No quotes."},
                        {"role": "user", "content": snippet}
                    ],
                    "stream": False,
                    "think": False,
                    "options": {"temperature": 0.7, "num_predict": 40}
                }).encode()
                req = urllib.request.Request(
                    "http://localhost:11434/api/chat",
                    data=payload,
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    resp_data = json.loads(resp.read())
                raw = resp_data.get("message", {}).get("content", "").strip().strip('"\'')
                # Take first line only
                suggestion = raw.split('\n')[0].strip()
                if len(suggestion) > 80:
                    suggestion = suggestion[:77] + '…'
                self._send_json({'suggestion': suggestion})
            except Exception:
                self._send_json({'suggestion': ''})

        elif self.path == '/api/search-suggest':
            try:
                body = self._read_body()
                query = body.get('query', '').strip()
                if not query or len(query) < 2:
                    self._send_json({'suggestions': []})
                    return
                payload = json.dumps({
                    "model": "qwen3:0.6b",
                    "messages": [
                        {"role": "system", "content": "You are a search autocomplete engine. Given a partial search query, suggest 4 completions. Return ONLY a JSON array of strings, nothing else. Example: [\"machine learning basics\", \"machine learning tutorial\"]"},
                        {"role": "user", "content": query}
                    ],
                    "stream": False,
                    "think": False,
                    "options": {"temperature": 0.7, "num_predict": 120}
                }).encode()
                req = urllib.request.Request(
                    "http://localhost:11434/api/chat",
                    data=payload,
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp_data = json.loads(resp.read())
                raw = resp_data.get("message", {}).get("content", "").strip()
                # Parse the JSON array from the response
                arr_match = re.search(r'\[.*\]', raw, re.DOTALL)
                if arr_match:
                    suggestions = json.loads(arr_match.group())
                    suggestions = [s for s in suggestions if isinstance(s, str) and s.strip()][:4]
                else:
                    suggestions = []
                self._send_json({'suggestions': suggestions})
            except Exception:
                self._send_json({'suggestions': []})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/upload$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            content_type = self.headers.get('Content-Type', '')
            if 'multipart/form-data' not in content_type:
                self._send_json({'error': 'multipart/form-data required'}, 400)
                return
            # Parse boundary from Content-Type
            boundary = None
            for part in content_type.split(';'):
                part = part.strip()
                if part.startswith('boundary='):
                    boundary = part[9:].strip('"')
            if not boundary:
                self._send_json({'error': 'Missing boundary'}, 400)
                return
            length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(length)
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
                base, ext = os.path.splitext(fname)
                i = 2
                while os.path.exists(fpath):
                    fpath = os.path.join(exp_dir, f'{base}_{i}{ext}')
                    i += 1
                with open(fpath, 'wb') as f:
                    f.write(file_data)
                uploaded.append(os.path.basename(fpath))
            self._send_json({'uploaded': uploaded}, 201)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/create-folder$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            name = body.get('name', '').strip()
            if not name or '..' in name or '/' in name:
                self._send_json({'error': 'Invalid folder name'}, 400)
                return
            folder_path = os.path.join(exp_dir, name)
            if os.path.exists(folder_path):
                self._send_json({'error': 'Folder already exists'}, 409)
                return
            os.makedirs(folder_path)
            self._send_json({'ok': True, 'name': name}, 201)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/delete-folder$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            folder = body.get('folder', '').strip()
            if not folder or '..' in folder or '/' in folder:
                self._send_json({'error': 'Invalid folder name'}, 400)
                return
            folder_path = os.path.join(exp_dir, folder)
            if not os.path.isdir(folder_path):
                self._send_json({'error': 'Folder not found'}, 404)
                return
            shutil.rmtree(folder_path)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/rename-folder$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            old_name = body.get('oldName', '').strip()
            new_name = body.get('newName', '').strip()
            if not old_name or '..' in old_name or '/' in old_name:
                self._send_json({'error': 'Invalid old folder name'}, 400)
                return
            if not new_name or '..' in new_name or '/' in new_name:
                self._send_json({'error': 'Invalid new folder name'}, 400)
                return
            old_path = os.path.join(exp_dir, old_name)
            new_path = os.path.join(exp_dir, new_name)
            if not os.path.isdir(old_path):
                self._send_json({'error': 'Folder not found'}, 404)
                return
            if os.path.exists(new_path):
                self._send_json({'error': 'A folder with that name already exists'}, 409)
                return
            os.rename(old_path, new_path)
            self._send_json({'ok': True, 'name': new_name})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/move-file$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            old_path = body.get('oldPath', '').strip()
            new_path = body.get('newPath', '').strip()
            if not old_path or '..' in old_path or not new_path or '..' in new_path:
                self._send_json({'error': 'Invalid path'}, 400)
                return
            src = os.path.join(exp_dir, old_path)
            dst = os.path.join(exp_dir, new_path)
            if not os.path.isfile(src):
                self._send_json({'error': 'Source file not found'}, 404)
                return
            if os.path.exists(dst):
                self._send_json({'error': 'Destination already exists'}, 409)
                return
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            os.rename(src, dst)
            self._send_json({'ok': True, 'name': new_path})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/clone-repo$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            url = body.get('url', '').strip()
            github_re = re.compile(r'^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$')
            if not github_re.match(url):
                self._send_json({'error': 'Invalid GitHub URL. Expected: https://github.com/user/repo'}, 400)
                return
            # Derive folder name from URL
            folder = url.rstrip('/').split('/')[-1]
            if folder.endswith('.git'):
                folder = folder[:-4]
            if not folder or '..' in folder:
                self._send_json({'error': 'Invalid repository URL'}, 400)
                return
            clone_dir = os.path.join(exp_dir, folder)
            if os.path.exists(clone_dir):
                self._send_json({'error': f'Folder "{folder}" already exists'}, 409)
                return
            try:
                result = subprocess.run(
                    ['git', 'clone', '--depth', '1', url, folder],
                    cwd=exp_dir, capture_output=True, text=True, timeout=60
                )
                if result.returncode != 0:
                    # Clean up partial clone
                    if os.path.exists(clone_dir):
                        shutil.rmtree(clone_dir, ignore_errors=True)
                    self._send_json({'error': result.stderr.strip() or 'Clone failed'}, 500)
                    return
                # Remove .git directory — we just want the files
                git_dir = os.path.join(clone_dir, '.git')
                if os.path.isdir(git_dir):
                    shutil.rmtree(git_dir, ignore_errors=True)
                self._send_json({'folder': folder}, 201)
            except subprocess.TimeoutExpired:
                if os.path.exists(clone_dir):
                    shutil.rmtree(clone_dir, ignore_errors=True)
                self._send_json({'error': 'Clone timed out'}, 504)
            except Exception as e:
                if os.path.exists(clone_dir):
                    shutil.rmtree(clone_dir, ignore_errors=True)
                self._send_json({'error': str(e)}, 500)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            name = body.get('name', '').strip()
            allowed_ext = ('.md', '.ipynb', '.py', '.tex', '.png', '.svg', '.mermaid', '.draw', '.slides')
            if not name or not any(name.endswith(e) for e in allowed_ext):
                self._send_json({'error': f'Name must end with {", ".join(allowed_ext)}'}, 400)
                return
            fpath = os.path.join(exp_dir, name)
            # For template-based .tex files, check the folder instead
            template_key = body.get('template') if name.endswith('.tex') else None
            if template_key:
                folder_dir = os.path.join(exp_dir, template_key)
                if os.path.exists(folder_dir):
                    self._send_json({'error': 'Folder already exists'}, 409)
                    return
            elif os.path.exists(fpath):
                self._send_json({'error': 'File already exists'}, 409)
                return
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
                    templates_dir = os.path.join(os.path.dirname(__file__), 'templates', template_key)
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
            self._send_json({'name': name}, 201)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/execute$'):
            exp_id = m.group(1)
            if not read_meta(exp_id):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            code = body.get('code', '')
            stream = body.get('stream', False)
            if stream:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'keep-alive')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                connected = [True]
                def is_connected():
                    return connected[0]
                try:
                    _execute_code_streaming(exp_id, code, self.wfile, is_connected)
                except (BrokenPipeError, ConnectionResetError):
                    connected[0] = False
            else:
                outputs = _execute_code(exp_id, code)
                self._send_json({'outputs': outputs})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/kernel/restart$'):
            exp_id = m.group(1)
            _kill_kernel(exp_id)
            _get_kernel(exp_id)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/kernel/interrupt$'):
            exp_id = m.group(1)
            with _kernels_lock:
                entry = _kernels.get(exp_id)
            if entry and entry['km'].is_alive():
                try:
                    entry['km'].interrupt_kernel()
                    self._send_json({'ok': True})
                except Exception as e:
                    self._send_json({'error': str(e)}, 500)
            else:
                self._send_json({'error': 'No running kernel'}, 404)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/venv$'):
            exp_id = m.group(1)
            if not read_meta(exp_id):
                self._send_json({'error': 'Not found'}, 404)
                return
            try:
                python_path = _create_venv(exp_id)
                self._send_json({'ok': True, 'pythonPath': python_path})
            except Exception as e:
                self._send_json({'error': str(e)}, 500)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/packages$'):
            exp_id = m.group(1)
            if not read_meta(exp_id):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            packages_str = body.get('packages', '').strip()
            if not packages_str:
                self._send_json({'error': 'packages required'}, 400)
                return
            if not _validate_package_names(packages_str):
                self._send_json({'error': 'Invalid package name'}, 400)
                return
            python_path = _get_python_path(exp_id)
            pkg_list = packages_str.split()
            try:
                result = subprocess.run(
                    [python_path, '-m', 'pip', 'install'] + pkg_list,
                    capture_output=True, text=True, timeout=120
                )
                if result.returncode != 0:
                    self._send_json({'error': result.stderr or result.stdout}, 500)
                    return
                _kill_kernel(exp_id)
                self._send_json({'ok': True, 'output': result.stdout})
            except Exception as e:
                self._send_json({'error': str(e)}, 500)

        elif self.path == '/api/experiments/move-unstructured-file':
            body = self._read_body()
            filename = body.get('filename', '').strip()
            target_exp = body.get('targetExp', '').strip()
            if not filename or not target_exp or '..' in filename or '..' in target_exp:
                self._send_json({'error': 'Invalid parameters'}, 400)
                return
            src = os.path.join(EXPERIMENTS_DIR, '_unstructured', filename)
            dst_dir = os.path.join(EXPERIMENTS_DIR, target_exp)
            if not os.path.isfile(src):
                self._send_json({'error': 'Source file not found'}, 404)
                return
            if not os.path.isdir(dst_dir):
                self._send_json({'error': 'Target experiment not found'}, 404)
                return
            dst = os.path.join(dst_dir, filename)
            if os.path.exists(dst):
                self._send_json({'error': 'File already exists in target project'}, 409)
                return
            shutil.move(src, dst)
            self._send_json({'ok': True})

        # ── Vault Notes API (POST) ──
        elif self.path == '/api/vault/notes':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
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
            self._send_json(note, 201)

        # ── Marimo Notebook API ──
        elif self.path == '/api/vault/marimo/start':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            note_id = body.get('note_id')
            if not note_id:
                self._send_json({'error': 'note_id required'}, 400)
                return
            # If already running, return existing port
            if note_id in _marimo_servers:
                self._send_json({'port': _marimo_servers[note_id]['port']})
                return
            user_vault = _get_user_vault_path(google_id)
            note_path, note = _find_vault_note_by_id(user_vault, note_id)
            if not note or note.get('type') != 'marimo':
                self._send_json({'error': 'Marimo note not found'}, 404)
                return
            # Write content to temp .py file
            py_path = os.path.join(user_vault, f'.marimo_{note_id}.py')
            with open(py_path, 'w', encoding='utf-8') as f:
                f.write(note.get('content', ''))
            # Find free port and launch marimo
            port = _find_free_port()
            try:
                proc = subprocess.Popen(
                    ['marimo', 'edit', py_path, '--headless', '--no-token', '-p', str(port)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                _marimo_servers[note_id] = {'proc': proc, 'port': port, 'py_path': py_path, 'note_path': note_path}
                self._send_json({'port': port})
            except FileNotFoundError:
                os.remove(py_path)
                self._send_json({'error': 'marimo is not installed. Run: pip install marimo'}, 500)

        elif self.path == '/api/vault/marimo/stop':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            note_id = body.get('note_id')
            if not note_id or note_id not in _marimo_servers:
                self._send_json({'error': 'No marimo server running for this note'}, 404)
                return
            info = _marimo_servers.pop(note_id)
            # Read back the .py file to get updated content
            updated_content = ''
            try:
                with open(info['py_path'], 'r', encoding='utf-8') as f:
                    updated_content = f.read()
            except:
                pass
            # Kill the marimo process
            try:
                info['proc'].terminate()
                info['proc'].wait(timeout=5)
            except:
                try:
                    info['proc'].kill()
                except:
                    pass
            # Remove temp file
            try:
                os.remove(info['py_path'])
            except:
                pass
            # Update the vault note content
            user_vault = _get_user_vault_path(google_id)
            note_path, note = _find_vault_note_by_id(user_vault, note_id)
            if note and note_path:
                note['content'] = updated_content
                note['updated'] = int(time.time())
                _write_vault_md(note_path, note)
            self._send_json({'ok': True, 'content': updated_content})

        # ── Vault Path API (PUT) ──
        elif self.path == '/api/vault/path':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            path = body.get('path', '').strip()
            success, message = _set_user_vault_path(google_id, path if path else None)
            if success:
                self._send_json({'ok': True, 'message': message, 'path': _get_user_vault_path(google_id)})
            else:
                self._send_json({'error': message}, 400)

        elif self.path == '/api/reveal-in-finder':
            body = self._read_body()
            filename = body.get('filename', '').strip()
            if not filename:
                self._send_json({'error': 'Missing filename'}, 400)
                return
            # Look for file in the user's Downloads folder
            downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
            filepath = os.path.join(downloads_dir, filename)
            if os.path.exists(filepath):
                # open -R selects the file in Finder
                subprocess.Popen(['open', '-R', filepath])
                self._send_json({'ok': True})
            else:
                # Fall back to just opening the Downloads folder
                subprocess.Popen(['open', downloads_dir])
                self._send_json({'ok': True, 'fallback': True})

        # ── Blog Vote API ──
        elif m := self._match(r'^/api/blog/([^/]+)/([^/]+)/vote$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            username = m.group(1)
            slug = m.group(2)
            body = self._read_body()
            vote = body.get('vote', 0)  # 1 = upvote, -1 = downvote, 0 = remove
            if vote not in (-1, 0, 1):
                self._send_json({'error': 'Invalid vote'}, 400)
                return
            result = set_blog_vote(username, slug, google_id, vote)
            self._send_json(result)

        # ── Blog Unpublish API ──
        elif m := self._match(r'^/api/blog/([^/]+)/([^/]+)/unpublish$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            username = m.group(1)
            slug = m.group(2)
            user_info = get_user_info(google_id)
            if not user_info or user_info.get('username') != username:
                self._send_json({'error': 'Not authorized'}, 403)
                return
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
                            self._send_json({'ok': True})
                            return
                    except:
                        pass
            self._send_json({'error': 'Post not found'}, 404)

        elif self.path == '/api/experiments':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            title = body.get('title', '').strip()
            desc = body.get('desc', '').strip()
            if not title:
                self._send_json({'error': 'Title required'}, 400)
                return
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
            self._send_json(meta, 201)

        elif self.path == '/api/todos':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            title = body.get('title', '').strip()
            if not title:
                self._send_json({'error': 'title required'}, 400)
                return
            todo = create_todo(google_id, body)
            self._send_json(todo, 201)

        elif self.path == '/api/calendar':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            title = body.get('title', '').strip()
            if not title:
                self._send_json({'error': 'title required'}, 400)
                return
            event = create_calendar_event(google_id, body)
            self._send_json(event, 201)

        elif self.path == '/api/blocked-titles':
            body = self._read_body()
            title = body.get('title', '').strip()
            if not title:
                self._send_json({'error': 'title required'}, 400)
                return
            titles = read_blocked_titles()
            if title not in titles:
                titles.append(title)
                write_blocked_titles(titles)
            self._send_json({'ok': True})

        elif self.path == '/api/adblock-rules/reset':
            update_adblock_lists()
            self._send_json(get_adblock_stats())

        elif self.path == '/api/comments':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            paper_link = body.get('paperLink', '').strip()
            content = body.get('content', '').strip()
            if not paper_link or not content:
                self._send_json({'error': 'paperLink and content required'}, 400)
                return
            comment = db_create_comment(google_id, body)
            self._send_json(comment, 201)

        elif self.path == '/api/reposts':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            paper_link = body.get('paperLink', '').strip()
            paper_title = body.get('paperTitle', '').strip()
            username = body.get('username', '').strip()
            if not paper_link:
                self._send_json({'error': 'paperLink required'}, 400)
                return
            repost = create_repost(google_id, username, paper_link, paper_title)
            self._send_json(repost, 201)

        elif self.path == '/api/saved-content':
            body = self._read_body()
            url = body.get('url', '').strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            write_saved_content(url, {
                'url': url,
                'title': body.get('title', ''),
                'text': body.get('text', ''),
                'savedAt': body.get('savedAt', int(time.time() * 1000))
            })
            self._send_json({'ok': True})

        elif self.path == '/api/saved-posts':
            body = self._read_body()
            url = body.get('url', '').strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            title = body.get('title', url)
            favicon = body.get('favicon', '')
            hostname = body.get('hostname', '')
            # Try to find an authenticated user; if not, save without user context
            google_id = self._get_user()
            if google_id:
                # Merge into user's synced savedPosts
                data = get_all_user_data(google_id)
                saved = data.get('savedPosts', {}).get('value', {})
                if isinstance(saved, str):
                    try: saved = json.loads(saved)
                    except: saved = {}
                if url in saved:
                    self._send_json({'exists': True})
                    return
                saved[url] = {
                    'paper': {'title': title, 'link': url, 'favicon': favicon, 'hostname': hostname},
                    'savedAt': int(time.time() * 1000),
                    'read': False
                }
                set_user_data(google_id, 'savedPosts', saved)
                self._send_json({'ok': True})
            else:
                # No auth — just acknowledge (extension can still save content)
                self._send_json({'ok': True})

        elif self.path == '/api/custom-feeds':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            url = (body.get('url') or '').strip()
            name = (body.get('name') or '').strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            data = get_all_user_data(google_id)
            feeds = data.get('customFeeds', {}).get('value', [])
            if isinstance(feeds, str):
                try: feeds = json.loads(feeds)
                except: feeds = []
            if not isinstance(feeds, list):
                feeds = []
            if any(f.get('url') == url for f in feeds):
                self._send_json({'exists': True})
                return
            feeds.append({'url': url, 'name': name or url, 'enabled': True})
            set_user_data(google_id, 'customFeeds', feeds)
            self._send_json({'ok': True, 'name': name or url})

        elif self.path == '/api/messages':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            to_username = (body.get('to_username') or '').strip()
            content = (body.get('content') or '').strip()
            if not to_username or not content:
                self._send_json({'error': 'to_username and content required'}, 400)
                return
            to_google_id = get_user_by_username(to_username)
            if not to_google_id:
                self._send_json({'error': 'User not found'}, 404)
                return
            if to_google_id == google_id:
                self._send_json({'error': 'Cannot message yourself'}, 400)
                return
            msg = send_direct_message(google_id, to_google_id, content)
            self._send_json(msg)

        elif (m := self._match(r'^/api/messages/([a-zA-Z0-9_-]+)/read$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            mark_message_read(google_id, m.group(1))
            self._send_json({'ok': True})

        elif (m := self._match(r'^/api/teams/(\d+)/messages$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            body = self._read_body()
            content = (body.get('content') or '').strip()
            if not content:
                self._send_json({'error': 'content required'}, 400)
                return
            msg = send_team_message(team_id, google_id, content)
            self._send_json(msg)

        elif (m := self._match(r'^/api/teams/(\d+)/chat-read$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            mark_team_chat_read(team_id, google_id)
            self._send_json({'ok': True})

        elif (m := self._match(r'^/api/teams/(\d+)/messages/([a-zA-Z0-9_-]+)/reactions$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            msg_id = m.group(2)
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            body = self._read_body()
            emoji = (body.get('emoji') or '').strip()
            if not emoji:
                self._send_json({'error': 'emoji required'}, 400)
                return
            result = toggle_reaction(msg_id, google_id, emoji)
            self._send_json(result)

        elif (m := self._match(r'^/api/teams/(\d+)/todos$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            body = self._read_body()
            title = (body.get('title') or '').strip()
            if not title:
                self._send_json({'error': 'title required'}, 400)
                return
            todo = create_team_todo(team_id, google_id, body)
            self._send_json(todo)

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_PUT(self):
        if m := self._match(r'^/api/todos/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            tid = m.group(1)
            body = self._read_body()
            result = update_todo(google_id, tid, body)
            if result:
                self._send_json(result)
            else:
                self._send_json({'error': 'Not found'}, 404)
            return

        # ── Vault Notes API (PUT) ──
        if m := self._match(r'^/api/vault/notes/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            note_id = m.group(1)
            user_vault = _get_user_vault_path(google_id)
            note_path, note = _find_vault_note_by_id(user_vault, note_id)
            if not note:
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            old_title = note.get('title', 'Untitled')
            new_title = body.get('title', old_title)
            note['title'] = new_title
            note['content'] = body.get('content', note.get('content', ''))
            if 'folder' in body:
                note['folder'] = body['folder']
            # Handle publishing
            new_achievement = None
            if 'published' in body:
                was_published = note.get('published', False)
                note['published'] = body['published']
                if body['published']:
                    note['slug'] = slugify(note['title']) or note_id
                    note['published_at'] = note.get('published_at') or int(time.time())
                    # Check for first_blog achievement
                    if not was_published:
                        new_achievement = grant_achievement(google_id, 'first_blog')
                else:
                    note['published_at'] = None
            note['updated'] = int(time.time())
            # Determine new filename based on title
            base_fname = _sanitize_vault_filename(new_title)
            new_fname = f'{base_fname}.md'
            new_path = os.path.join(user_vault, new_fname)
            # Handle conflicts (but allow keeping same file)
            if new_path != note_path and os.path.exists(new_path):
                counter = 1
                while os.path.exists(new_path):
                    new_fname = f'{base_fname} {counter}.md'
                    new_path = os.path.join(user_vault, new_fname)
                    counter += 1
            # Remove old file if path changed
            if note_path and note_path != new_path and os.path.exists(note_path):
                os.remove(note_path)
            _write_vault_md(new_path, note)
            response = dict(note)
            if new_achievement:
                response['achievement'] = new_achievement
            self._send_json(response)
            return

        if m := self._match(r'^/api/calendar/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            eid = m.group(1)
            body = self._read_body()
            result = update_calendar_event(google_id, eid, body)
            if result:
                self._send_json(result)
            else:
                self._send_json({'error': 'Not found'}, 404)
            return

        if self.path == '/api/quality-prompt':
            body = self._read_body()
            prompt = body.get('prompt', '')
            write_prompt(prompt)
            self._send_json({'ok': True, 'prompt': read_prompt()})
            return

        if m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/runs/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
            rid = m.group(2)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            for r in meta.get('runs', []):
                if r['id'] == rid:
                    for key in ('name', 'status', 'notes', 'results', 'algorithm', 'environment', 'reward', 'episodes', 'hyperparameters'):
                        if key in body:
                            r[key] = body[key]
                    write_meta(exp_id, meta)
                    self._send_json(r)
                    return
            self._send_json({'error': 'Run not found'}, 404)
            return

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+)$'):
            exp_id = m.group(1)
            fname = url_unquote(m.group(2))
            if '..' in fname:
                self._send_json({'error': 'Invalid path'}, 400)
                return
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            body = self._read_body()
            # Rename if 'rename' field is provided
            if 'rename' in body:
                if not os.path.isfile(fpath):
                    self._send_json({'error': 'Not found'}, 404)
                    return
                new_name = body['rename'].strip()
                if not new_name:
                    self._send_json({'error': 'Name required'}, 400)
                    return
                new_path = os.path.join(EXPERIMENTS_DIR, exp_id, new_name)
                if os.path.exists(new_path):
                    self._send_json({'error': 'File already exists'}, 409)
                    return
                os.rename(fpath, new_path)
                self._send_json({'ok': True, 'name': new_name})
            else:
                os.makedirs(os.path.dirname(fpath), exist_ok=True)
                with open(fpath, 'w') as f:
                    f.write(body.get('content', ''))
                self._send_json({'ok': True})

        elif m := self._match(r'^/api/teams/(\d+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            body = self._read_body()
            new_name = body.get('name', '').strip()
            if not new_name:
                self._send_json({'error': 'Name required'}, 400)
                return
            if rename_team(team_id, new_name, google_id):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not team owner'}, 403)
            return

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/team$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            exp_id = m.group(1)
            body = self._read_body()
            team_id = body.get('team_id')
            if team_id is None:
                self._send_json({'error': 'team_id required'}, 400)
                return
            if set_experiment_team(exp_id, int(team_id), google_id):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not a team member'}, 403)
            return

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
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
            self._send_json(meta)
            return

        elif (m := self._match(r'^/api/teams/(\d+)/messages/([a-zA-Z0-9_-]+)$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            msg_id = m.group(2)
            body = self._read_body()
            content = (body.get('content') or '').strip()
            if not content:
                self._send_json({'error': 'content required'}, 400)
                return
            if update_team_message(team_id, msg_id, google_id, content):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found or not yours'}, 404)
            return

        elif (m := self._match(r'^/api/teams/(\d+)/todos/([a-zA-Z0-9_-]+)$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            todo_id = m.group(2)
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            body = self._read_body()
            result = update_team_todo(team_id, todo_id, body)
            if result:
                self._send_json(result)
            else:
                self._send_json({'error': 'Not found'}, 404)
            return

        elif self.path == '/api/users/me/picture':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            image_data = body.get('image', '')
            if not image_data or not image_data.startswith('data:image/'):
                self._send_json({'error': 'Invalid image data'}, 400)
                return
            # Extract format and base64 content
            header, b64 = image_data.split(',', 1)
            ext = 'jpg'
            if 'png' in header:
                ext = 'png'
            elif 'webp' in header:
                ext = 'webp'
            import hashlib
            fname = hashlib.sha256(google_id.encode()).hexdigest()[:16] + '_pic.' + ext
            fpath = os.path.join(UPLOADS_DIR, fname)
            with open(fpath, 'wb') as f:
                f.write(base64.b64decode(b64))
            picture_url = '/uploads/' + fname
            update_user_picture(google_id, picture_url)
            self._send_json({'ok': True, 'picture': picture_url})
            return

        elif self.path == '/api/users/me/background':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            image_data = body.get('image', '')
            if not image_data or not image_data.startswith('data:image/'):
                self._send_json({'error': 'Invalid image data'}, 400)
                return
            header, b64 = image_data.split(',', 1)
            ext = 'jpg'
            if 'png' in header:
                ext = 'png'
            elif 'webp' in header:
                ext = 'webp'
            import hashlib
            fname = hashlib.sha256(google_id.encode()).hexdigest()[:16] + '_bg.' + ext
            fpath = os.path.join(UPLOADS_DIR, fname)
            with open(fpath, 'wb') as f:
                f.write(base64.b64decode(b64))
            bg_url = '/uploads/' + fname
            update_user_profile_bg(google_id, bg_url)
            self._send_json({'ok': True, 'profile_bg': bg_url})
            return

        elif self.path == '/api/users/me/privacy':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            private = bool(body.get('profile_private', False))
            set_profile_private(google_id, private)
            self._send_json({'ok': True, 'profile_private': private})
            return

        elif self.path == '/api/users/me/status':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            emoji = (body.get('emoji') or '').strip()
            text = (body.get('text') or '').strip()[:80]
            valid_emojis = ('cat', 'dog', 'bunny', 'froog', 'blackCat', 'poodle', 'pacman', '')
            if emoji and emoji not in valid_emojis:
                self._send_json({'error': 'Invalid emoji type'}, 400)
                return
            update_user_status(google_id, emoji, text)
            self._send_json({'ok': True, 'status_emoji': emoji or None, 'status_text': text or None})
            return

        elif (m := self._match(r'^/api/teams/(\d+)/privacy$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            body = self._read_body()
            private = bool(body.get('private', False))
            if set_team_private(team_id, private, google_id):
                self._send_json({'ok': True, 'private': private})
            else:
                self._send_json({'error': 'Not team owner'}, 403)
            return

        elif (m := self._match(r'^/api/teams/(\d+)/parent$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            body = self._read_body()
            parent_id = body.get('parent_id')
            if parent_id is not None:
                parent_id = int(parent_id)
            if set_team_parent(team_id, parent_id, google_id):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not allowed or circular reference'}, 403)
            return

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_DELETE(self):
        if self.path == '/api/reposts':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            body = self._read_body()
            paper_link = body.get('paperLink', '').strip()
            if not paper_link:
                self._send_json({'error': 'paperLink required'}, 400)
                return
            delete_repost(google_id, paper_link)
            self._send_json({'ok': True})
            return

        # ── Vault Notes API (DELETE) ──
        elif m := self._match(r'^/api/vault/notes/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            note_id = m.group(1)
            user_vault = _get_user_vault_path(google_id)
            note_path, note = _find_vault_note_by_id(user_vault, note_id)
            if note_path and os.path.exists(note_path):
                os.remove(note_path)
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)
            return

        elif m := self._match(r'^/api/todos/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            if delete_todo(google_id, m.group(1)):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)
            return

        elif m := self._match(r'^/api/calendar/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            if delete_calendar_event(google_id, m.group(1)):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/runs/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
            rid = m.group(2)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
            meta['runs'] = [r for r in meta.get('runs', []) if r['id'] != rid]
            write_meta(exp_id, meta)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+)$'):
            exp_id = m.group(1)
            fname = url_unquote(m.group(2))
            if '..' in fname:
                self._send_json({'error': 'Invalid path'}, 400)
                return
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if os.path.isfile(fpath):
                os.remove(fpath)
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/packages/(.+)$'):
            exp_id = m.group(1)
            package = m.group(2)
            if not read_meta(exp_id):
                self._send_json({'error': 'Not found'}, 404)
                return
            if not _validate_package_names(package):
                self._send_json({'error': 'Invalid package name'}, 400)
                return
            python_path = _get_python_path(exp_id)
            try:
                result = subprocess.run(
                    [python_path, '-m', 'pip', 'uninstall', '-y', package],
                    capture_output=True, text=True, timeout=60
                )
                _kill_kernel(exp_id)
                self._send_json({'ok': True})
            except Exception as e:
                self._send_json({'error': str(e)}, 500)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/venv$'):
            exp_id = m.group(1)
            venv_dir = os.path.join(EXPERIMENTS_DIR, exp_id, 'venv')
            if not os.path.isdir(venv_dir):
                self._send_json({'error': 'No venv found'}, 404)
                return
            _kill_kernel(exp_id)
            shutil.rmtree(venv_dir)
            meta = read_meta(exp_id)
            if meta:
                meta['pythonPath'] = 'python3'
                write_meta(exp_id, meta)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/kernel$'):
            exp_id = m.group(1)
            _kill_kernel(exp_id)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            exp_id = m.group(1)
            if not user_can_access_experiment(exp_id, google_id):
                self._send_json({'error': 'Forbidden'}, 403)
                return
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if os.path.isdir(exp_dir):
                _kill_kernel(exp_id)
                shutil.rmtree(exp_dir)
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif self.path == '/api/blocked-titles':
            write_blocked_titles([])
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/comments/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            if db_delete_comment(google_id, m.group(1)):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found or not authorized'}, 404)

        elif m := self._match(r'^/api/teams/(\d+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            if delete_team(int(m.group(1)), google_id):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not allowed or not found'}, 403)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/team$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            remove_experiment_team(m.group(1))
            self._send_json({'ok': True})

        elif (m := self._match(r'^/api/teams/(\d+)/messages/([a-zA-Z0-9_-]+)$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            msg_id = m.group(2)
            if delete_team_message(team_id, msg_id, google_id):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found or not yours'}, 404)

        elif (m := self._match(r'^/api/teams/(\d+)/todos/([a-zA-Z0-9_-]+)$')):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            team_id = int(m.group(1))
            todo_id = m.group(2)
            from persistence import _get_db
            conn = _get_db()
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?",
                (team_id, google_id)
            ).fetchone()
            conn.close()
            if not member:
                self._send_json({'error': 'Not a team member'}, 403)
                return
            if delete_team_todo(team_id, todo_id):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif m := self._match(r'^/api/messages/([a-zA-Z0-9_-]+)$'):
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            if delete_direct_message(google_id, m.group(1)):
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        else:
            self._send_json({'error': 'Not found'}, 404)


class ThreadingHTTPServer(http.server.HTTPServer):
    import socketserver
    _mixin = socketserver.ThreadingMixIn
    allow_reuse_address = True
    daemon_threads = True
    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            pass
        finally:
            from terminal_server import hijacked_sockets
            if id(request) in hijacked_sockets:
                hijacked_sockets.discard(id(request))
            else:
                self.shutdown_request(request)
    def process_request(self, request, client_address):
        import threading
        t = threading.Thread(target=self.process_request_thread, args=(request, client_address))
        t.daemon = True
        t.start()

httpd = ThreadingHTTPServer(('', PORT), Handler)
print(f'Serving at http://localhost:{PORT}')
httpd.serve_forever()
