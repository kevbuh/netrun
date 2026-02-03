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
    get_all_user_data, set_user_data, set_user_data_bulk,
    create_team, get_user_teams, get_team, delete_team,
    invite_to_team, get_pending_invites, respond_to_invite,
    remove_team_member, set_experiment_team, remove_experiment_team,
    get_experiment_team, get_team_experiments,
    set_experiment_owner, get_user_experiment_ids, user_can_access_experiment,
    get_user_calendar, create_calendar_event, update_calendar_event, delete_calendar_event,
    get_user_todos, create_todo, update_todo, delete_todo,
    db_get_comments, db_create_comment, db_delete_comment,
    get_public_user_info, get_user_public_stats, get_user_recent_comments, create_repost, delete_repost, get_user_reposts, get_user_feed_sources,
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
    read_adblock_rules, write_adblock_rules, DEFAULT_ADBLOCK_RULES, clean_html,
)
from kernels import (
    _get_kernel, _kill_kernel, _get_python_path,
    _validate_package_names, _create_venv,
    _execute_code, _execute_code_streaming,
)

PORT = _args.port
GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com'

# In-memory cache for extracted document text: url -> { text, pages }
_extract_cache = {}
# In-memory cache for paper insights: url -> { repos, contribution }
_insights_cache = {}
# On-disk cache for URL-to-PDF conversions: url -> file path
_pdf_cache_dir = os.path.join(DIR, '.pdf-cache')
os.makedirs(_pdf_cache_dir, exist_ok=True)
_pdf_cache = {}  # url -> pdf_path

# Uploads directory for profile pictures and backgrounds
UPLOADS_DIR = os.path.join(DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Auto-create _unstructured pseudo-experiment for loose files
_unstructured_dir = os.path.join(EXPERIMENTS_DIR, '_unstructured')
os.makedirs(_unstructured_dir, exist_ok=True)
_unstructured_meta = os.path.join(_unstructured_dir, 'meta.json')
if not os.path.isfile(_unstructured_meta):
    with open(_unstructured_meta, 'w') as f:
        json.dump({'title': 'Unstructured Files', 'desc': '', 'created': None, 'runs': []}, f)


_static_dir = _args.static_dir or DIR

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
            if self.path == '/ws/terminal' and self.headers.get('Upgrade', '').lower() == 'websocket':
                from terminal_server import handle_websocket_upgrade_raw
                handle_websocket_upgrade_raw(self)
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

    def do_GET(self):
        # WebSocket upgrade is handled in handle_one_request() before we get here
        if self.path == '/ws/terminal':
            self._send_json({'error': 'Expected WebSocket upgrade'}, 400)
            return

        if self.path == '/api/settings':
            self._send_json({'ok': True})
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

        elif self.path.startswith('/api/openreview-search'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            title = qs.get('title', [''])[0].strip()
            if not title:
                self._send_json({'url': None})
                return
            try:
                search_url = (
                    'https://api.openreview.net/notes/search?query='
                    + urllib.request.quote(title)
                    + '&limit=3'
                )
                req = urllib.request.Request(
                    search_url,
                    headers={'User-Agent': 'Mozilla/5.0'}
                )
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                    data = json.loads(resp.read())
                notes = data.get('notes', [])
                # Find a note whose title closely matches
                title_lower = title.lower().strip()
                for note in notes:
                    note_content = note.get('content', {})
                    note_title = note_content.get('title', '')
                    if isinstance(note_title, dict):
                        note_title = note_title.get('value', '')
                    if note_title.lower().strip() == title_lower:
                        forum_id = note.get('forum') or note.get('id', '')
                        self._send_json({'url': f'https://openreview.net/forum?id={forum_id}'})
                        return
                self._send_json({'url': None})
            except Exception:
                self._send_json({'url': None})

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

        elif self.path.startswith('/api/openalex-search'):
            try:
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                query = qs.get('q', [''])[0].strip()
                page = int(qs.get('page', ['1'])[0])
                per_page = int(qs.get('per_page', ['100'])[0])
                if not query:
                    self._send_json({'error': 'Query required'}, 400)
                    return
                # Parse by: prefix — everything after by: is author
                by_match = re.search(r'\bby:(.+)', query)
                author_name = by_match.group(1).strip() if by_match else None
                rest_query = query[:by_match.start()].strip() if by_match else query
                filters = []
                if author_name:
                    filters.append(f'author.search:{urllib.request.quote(author_name)}')
                search_param = f'search={urllib.request.quote(rest_query)}&' if rest_query else ''
                filter_param = f'filter={",".join(filters)}&' if filters else ''
                sort_param = 'sort=cited_by_count:desc&' if author_name and not rest_query else ''
                search_url = (
                    f'https://api.openalex.org/works?{search_param}{filter_param}{sort_param}'
                    f'page={page}&per_page={per_page}'
                    f'&select=id,doi,title,authorships,publication_date,cited_by_count,primary_location,type'
                )
                req = urllib.request.Request(
                    search_url,
                    headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
                )
                ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        # ── Vault Notes API ──
        elif self.path == '/api/vault/notes':
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            user_vault = os.path.join(VAULT_DIR, google_id)
            os.makedirs(user_vault, exist_ok=True)
            notes = []
            for fname in os.listdir(user_vault):
                if fname.endswith('.json'):
                    try:
                        with open(os.path.join(user_vault, fname), 'r') as f:
                            note = json.load(f)
                            notes.append(note)
                    except:
                        pass
            notes.sort(key=lambda n: n.get('updated', 0), reverse=True)
            self._send_json(notes)

        elif m := self._match(r'^/api/vault/notes/([a-zA-Z0-9_-]+)$'):
            note_id = m.group(1)
            google_id = self._get_user()
            if not google_id:
                self._send_json({'error': 'Not authenticated'}, 401)
                return
            note_path = os.path.join(VAULT_DIR, google_id, f'{note_id}.json')
            if os.path.exists(note_path):
                with open(note_path, 'r') as f:
                    self._send_json(json.load(f))
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
            user_vault = os.path.join(VAULT_DIR, google_id)
            # Find published note with matching slug
            if os.path.isdir(user_vault):
                for fname in os.listdir(user_vault):
                    if fname.endswith('.json'):
                        try:
                            with open(os.path.join(user_vault, fname), 'r') as f:
                                note = json.load(f)
                                if note.get('published') and note.get('slug') == slug:
                                    self._send_json({
                                        'title': note.get('title', 'Untitled'),
                                        'content': note.get('content', ''),
                                        'author': username,
                                        'published_at': note.get('published_at'),
                                        'picture': user_info.get('picture')
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
            user_vault = os.path.join(VAULT_DIR, google_id)
            posts = []
            if os.path.isdir(user_vault):
                for fname in os.listdir(user_vault):
                    if fname.endswith('.json'):
                        try:
                            with open(os.path.join(user_vault, fname), 'r') as f:
                                note = json.load(f)
                                if note.get('published'):
                                    posts.append({
                                        'title': note.get('title', 'Untitled'),
                                        'slug': note.get('slug'),
                                        'published_at': note.get('published_at')
                                    })
                        except:
                            pass
            posts.sort(key=lambda p: p.get('published_at', 0), reverse=True)
            self._send_json({'posts': posts, 'author': username, 'picture': user_info.get('picture')})

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
            self._send_json(read_adblock_rules())
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

        elif self.path == '/api/paper-insights':
            try:
                body = self._read_body()
                url = body.get('url', '').strip()
                if not url:
                    self._send_json({'error': 'url required'}, 400)
                    return
                allow_heuristics = body.get('allowHeuristics', True)
                _cache_key = url + ('::h' if allow_heuristics else '::noh')
                if _cache_key in _insights_cache:
                    self._send_json(_insights_cache[_cache_key])
                    return

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

                result = {'repos': repos, 'insights': insights}
                _insights_cache[_cache_key] = result
                self._send_json(result)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path == '/api/doc-chat':
            try:
                body = self._read_body()
                context = body.get('context', '')
                messages = body.get('messages', [])
                if not messages:
                    self._send_json({'error': 'messages required'}, 400)
                    return
                truncated_ctx = context[:12000]
                system_msg = (
                    "You are a helpful research assistant. The user is reading a document. "
                    "Answer their questions based ONLY on the document text below. "
                    "Do not make up information that is not in the document.\n\n"
                    "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
                )
                ollama_messages = [{"role": "system", "content": system_msg}] + messages
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
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'keep-alive')
                self.end_headers()
                try:
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        for line in resp:
                            chunk = json.loads(line)
                            token = chunk.get("message", {}).get("content", "")
                            if token:
                                self.wfile.write(f'event: token\ndata: {json.dumps(token)}\n\n'.encode())
                                self.wfile.flush()
                            if chunk.get("done"):
                                break
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
            note = {
                'id': note_id,
                'title': body.get('title', 'Untitled'),
                'content': body.get('content', ''),
                'folder': body.get('folder'),
                'created': int(time.time()),
                'updated': int(time.time())
            }
            user_vault = os.path.join(VAULT_DIR, google_id)
            os.makedirs(user_vault, exist_ok=True)
            with open(os.path.join(user_vault, f'{note_id}.json'), 'w') as f:
                json.dump(note, f, indent=2)
            self._send_json(note, 201)

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
            write_adblock_rules(DEFAULT_ADBLOCK_RULES)
            self._send_json(DEFAULT_ADBLOCK_RULES)

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
            note_path = os.path.join(VAULT_DIR, google_id, f'{note_id}.json')
            if not os.path.exists(note_path):
                self._send_json({'error': 'Not found'}, 404)
                return
            with open(note_path, 'r') as f:
                note = json.load(f)
            body = self._read_body()
            note['title'] = body.get('title', note.get('title', 'Untitled'))
            note['content'] = body.get('content', note.get('content', ''))
            if 'folder' in body:
                note['folder'] = body['folder']
            # Handle publishing
            if 'published' in body:
                note['published'] = body['published']
                if body['published']:
                    # Generate slug from title
                    note['slug'] = slugify(note['title']) or note_id
                    note['published_at'] = note.get('published_at') or int(time.time())
                else:
                    note['published_at'] = None
            note['updated'] = int(time.time())
            with open(note_path, 'w') as f:
                json.dump(note, f, indent=2)
            self._send_json(note)
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
            note_path = os.path.join(VAULT_DIR, google_id, f'{note_id}.json')
            if os.path.exists(note_path):
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
