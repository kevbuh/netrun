#!/usr/bin/env python3
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

PORT = 8000
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, content_type, timestamp)
_cache = {}
# In-memory cache for extracted document text: url -> { text, pages }
_extract_cache = {}
# In-memory cache for paper insights: url -> { repos, contribution }
_insights_cache = {}
DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')
CALENDAR_FILE = os.path.join(DIR, 'calendar.json')
TODOS_FILE = os.path.join(DIR, 'todos.json')
SAVED_POSTS_FILE = os.path.join(DIR, 'saved_posts.json')
SETTINGS_FILE = os.path.join(DIR, 'settings.json')
COMMENTS_FILE = os.path.join(DIR, 'comments.json')

os.makedirs(EXPERIMENTS_DIR, exist_ok=True)

# Persistent Jupyter kernels: exp_id -> { "km": KernelManager, "kc": KernelClient, "lock": Lock }
_kernels = {}
_kernels_lock = threading.Lock()


def _get_kernel(exp_id):
    """Get or start a persistent Jupyter kernel for an experiment."""
    import jupyter_client
    from jupyter_client.kernelspec import KernelSpecManager
    with _kernels_lock:
        entry = _kernels.get(exp_id)
        if entry and entry['km'].is_alive():
            return entry
        # Read pythonPath from meta
        meta = read_meta(exp_id)
        python_path = (meta or {}).get('pythonPath', 'python3')
        if os.path.isabs(python_path):
            # Write a kernel spec pointing to the venv python
            spec_dir = os.path.join(EXPERIMENTS_DIR, exp_id, '.kernels', 'venv')
            os.makedirs(spec_dir, exist_ok=True)
            with open(os.path.join(spec_dir, 'kernel.json'), 'w') as f:
                json.dump({
                    'argv': [python_path, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                    'display_name': 'Python (venv)',
                    'language': 'python'
                }, f)
            ksm = KernelSpecManager()
            ksm.kernel_dirs = [os.path.join(EXPERIMENTS_DIR, exp_id, '.kernels')]
            km = jupyter_client.KernelManager(kernel_name='venv', kernel_spec_manager=ksm)
        else:
            km = jupyter_client.KernelManager(kernel_name='python3')
        km.start_kernel(cwd=os.path.join(EXPERIMENTS_DIR, exp_id))
        kc = km.client()
        kc.start_channels()
        kc.wait_for_ready(timeout=30)
        entry = {'km': km, 'kc': kc, 'lock': threading.Lock()}
        _kernels[exp_id] = entry
        return entry


def _kill_kernel(exp_id):
    """Kill a kernel if it exists."""
    with _kernels_lock:
        entry = _kernels.pop(exp_id, None)
    if entry:
        try:
            entry['kc'].stop_channels()
        except Exception:
            pass
        try:
            entry['km'].shutdown_kernel(now=True)
        except Exception:
            pass


def _get_python_path(exp_id):
    """Get the pythonPath for an experiment, defaulting to python3."""
    meta = read_meta(exp_id)
    return (meta or {}).get('pythonPath', 'python3')


def _validate_package_names(packages_str):
    """Validate package names string to prevent shell injection."""
    if re.search(r'[;&|$`\\]', packages_str):
        return False
    return True


def _create_venv(exp_id):
    """Create a venv for an experiment, install ipykernel, update meta."""
    exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
    venv_dir = os.path.join(exp_dir, 'venv')
    subprocess.run([sys.executable, '-m', 'venv', venv_dir], check=True)
    python_path = os.path.join(venv_dir, 'bin', 'python')
    subprocess.run([python_path, '-m', 'pip', 'install', '-q', 'ipykernel'], check=True)
    meta = read_meta(exp_id)
    meta['pythonPath'] = python_path
    write_meta(exp_id, meta)
    _kill_kernel(exp_id)
    return python_path


def _execute_code(exp_id, code):
    """Execute code in the Jupyter kernel, return rich outputs."""
    entry = _get_kernel(exp_id)
    with entry['lock']:
        kc = entry['kc']
        km = entry['km']

        if not km.is_alive():
            with _kernels_lock:
                _kernels.pop(exp_id, None)
            entry = _get_kernel(exp_id)
            kc = entry['kc']

        msg_id = kc.execute(code)

        outputs = []
        deadline = time.time() + 300

        while time.time() < deadline:
            try:
                msg = kc.get_iopub_msg(timeout=1)
            except Exception:
                continue

            if msg['parent_header'].get('msg_id') != msg_id:
                continue

            msg_type = msg['msg_type']
            content = msg['content']

            if msg_type == 'stream':
                outputs.append({
                    'output_type': 'stream',
                    'name': content.get('name', 'stdout'),
                    'text': content.get('text', '')
                })
            elif msg_type in ('display_data', 'execute_result'):
                out = {
                    'output_type': msg_type,
                    'data': content.get('data', {}),
                    'metadata': content.get('metadata', {})
                }
                if msg_type == 'execute_result':
                    out['execution_count'] = content.get('execution_count')
                outputs.append(out)
            elif msg_type == 'error':
                outputs.append({
                    'output_type': 'error',
                    'ename': content.get('ename', ''),
                    'evalue': content.get('evalue', ''),
                    'traceback': content.get('traceback', [])
                })
            elif msg_type == 'status' and content.get('execution_state') == 'idle':
                break

        return outputs


def _execute_code_streaming(exp_id, code, wfile, is_connected):
    """Execute code and stream SSE events as outputs arrive."""
    entry = _get_kernel(exp_id)
    with entry['lock']:
        kc = entry['kc']
        km = entry['km']

        if not km.is_alive():
            with _kernels_lock:
                _kernels.pop(exp_id, None)
            entry = _get_kernel(exp_id)
            kc = entry['kc']

        msg_id = kc.execute(code)
        deadline = time.time() + 300

        while time.time() < deadline:
            if not is_connected():
                # Client disconnected — interrupt the kernel
                try:
                    km.interrupt_kernel()
                except Exception:
                    pass
                return

            try:
                msg = kc.get_iopub_msg(timeout=0.5)
            except Exception:
                continue

            if msg['parent_header'].get('msg_id') != msg_id:
                continue

            msg_type = msg['msg_type']
            content = msg['content']
            out = None

            if msg_type == 'stream':
                out = {
                    'output_type': 'stream',
                    'name': content.get('name', 'stdout'),
                    'text': content.get('text', '')
                }
            elif msg_type in ('display_data', 'execute_result'):
                out = {
                    'output_type': msg_type,
                    'data': content.get('data', {}),
                    'metadata': content.get('metadata', {})
                }
                if msg_type == 'execute_result':
                    out['execution_count'] = content.get('execution_count')
            elif msg_type == 'error':
                out = {
                    'output_type': 'error',
                    'ename': content.get('ename', ''),
                    'evalue': content.get('evalue', ''),
                    'traceback': content.get('traceback', [])
                }
            elif msg_type == 'status' and content.get('execution_state') == 'idle':
                try:
                    wfile.write(b'event: done\ndata: {}\n\n')
                    wfile.flush()
                except Exception:
                    pass
                return

            if out:
                try:
                    data = json.dumps(out)
                    wfile.write(f'event: output\ndata: {data}\n\n'.encode())
                    wfile.flush()
                except Exception:
                    return

        # Timed out
        try:
            wfile.write(b'event: done\ndata: {"timeout":true}\n\n')
            wfile.flush()
        except Exception:
            pass


def read_blocked_titles():
    if not os.path.exists(BLOCKED_TITLES_FILE):
        return []
    with open(BLOCKED_TITLES_FILE, 'r') as f:
        return json.load(f)


def write_blocked_titles(titles):
    with open(BLOCKED_TITLES_FILE, 'w') as f:
        json.dump(titles, f, indent=2)


def read_calendar():
    if not os.path.exists(CALENDAR_FILE):
        return []
    with open(CALENDAR_FILE, 'r') as f:
        return json.load(f)


def write_calendar(events):
    with open(CALENDAR_FILE, 'w') as f:
        json.dump(events, f, indent=2)


def read_todos():
    if not os.path.exists(TODOS_FILE):
        return []
    with open(TODOS_FILE, 'r') as f:
        return json.load(f)


def write_todos(todos):
    with open(TODOS_FILE, 'w') as f:
        json.dump(todos, f, indent=2)


def read_saved_posts():
    if not os.path.exists(SAVED_POSTS_FILE):
        return {}
    try:
        with open(SAVED_POSTS_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return {}


def write_saved_posts(data):
    tmp = SAVED_POSTS_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SAVED_POSTS_FILE)


def read_settings():
    if not os.path.exists(SETTINGS_FILE):
        return {}
    with open(SETTINGS_FILE, 'r') as f:
        return json.load(f)


def write_settings(data):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def read_comments():
    if not os.path.exists(COMMENTS_FILE):
        return []
    try:
        with open(COMMENTS_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return []


def write_comments(comments):
    tmp = COMMENTS_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(comments, f, indent=2)
    os.replace(tmp, COMMENTS_FILE)


def slugify(text):
    s = text.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s or 'experiment'


def unique_slug(base):
    slug = base
    i = 2
    while os.path.exists(os.path.join(EXPERIMENTS_DIR, slug)):
        slug = f'{base}-{i}'
        i += 1
    return slug


def read_meta(exp_id):
    path = os.path.join(EXPERIMENTS_DIR, exp_id, 'meta.json')
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)


def write_meta(exp_id, data):
    path = os.path.join(EXPERIMENTS_DIR, exp_id, 'meta.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def read_prompt():
    """Read the custom prompt from disk, or return None if not set."""
    if os.path.exists(PROMPT_FILE):
        with open(PROMPT_FILE, 'r') as f:
            text = f.read().strip()
            return text if text else None
    return None


def write_prompt(prompt):
    """Write a custom prompt to disk. Pass None/empty to delete."""
    if not prompt or not prompt.strip():
        if os.path.exists(PROMPT_FILE):
            os.remove(PROMPT_FILE)
    else:
        with open(PROMPT_FILE, 'w') as f:
            f.write(prompt.strip())


def get_active_prompt():
    """Return the custom prompt if set, otherwise the default."""
    return read_prompt() or DEFAULT_VERDICT_PROMPT


DEFAULT_VERDICT_PROMPT = (
    "You are a topic filter. Your job is to remove obvious junk from a feed reader.\n\n"
    "SKIP only if the title is clearly about: product reviews, buyer's guides, 'best X' roundups, "
    "deals, discounts, coupons, promo codes, gift guides, price comparisons, sales, "
    "VPN/mattress/sleep product reviews, TV/movie recommendations, recipes, fashion, "
    "celebrity gossip, rage bait, clickbait, SEO spam.\n\n"
    "KEEP everything else — science, technology, programming, news, culture, ideas, sports, "
    "politics, business, and anything that could be genuinely interesting to read.\n\n"
    "When in doubt, KEEP.\n\n"
    "Reply ONLY with KEEP or SKIP."
)


DEFAULT_SCORING_PROMPT = (
    "You are a relevance scorer for a general-interest reader who likes science, tech, ideas, and news.\n\n"
    "90-100: groundbreaking research, major discoveries, novel algorithms, important papers.\n"
    "80-89: significant releases, deep technical write-ups, compelling long-form journalism.\n"
    "70-79: solid content — interesting news, thoughtful analysis, useful tutorials, good discussions.\n"
    "60-69: decent content — general tech/science news, industry updates, opinion pieces with substance.\n"
    "40-59: mediocre — routine announcements, surface-level reporting, mildly interesting.\n"
    "20-39: low quality — listicles, rehashed takes, thin content.\n"
    "1-19: junk — product roundups, deals, SEO content, clickbait, engagement farming.\n"
    "0: spam.\n\n"
    "Be generous with interesting content. Most substantive articles should score 70+.\n\n"
    "Reply with ONLY a number 0-100."
)


def classify_title(title, system_msg=None):
    """Classify a single title as 'keep' or 'skip' via Ollama."""
    if system_msg is None:
        system_msg = DEFAULT_VERDICT_PROMPT
    payload = json.dumps({
        "model": "qwen2.5:7b",
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": title}
        ],
        "stream": False,
        "options": {"temperature": 0, "num_predict": 3}
    }).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp_data = json.loads(resp.read())
    raw = resp_data.get("message", {}).get("content", "").strip()
    return "keep" if raw.upper().startswith("KEEP") else "skip"


def cached_fetch(url, timeout=15):
    """Fetch a URL, returning cached bytes if fresh enough."""
    now = time.time()
    if url in _cache:
        data, ts = _cache[url]
        if now - ts < CACHE_TTL:
            return data
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    ctx = ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        data = resp.read()
    _cache[url] = (data, now)
    return data


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

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
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
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
        if self.path == '/feed':
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
                for m in markets[:5]:
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

        elif self.path == '/api/experiments':
            experiments = []
            if os.path.isdir(EXPERIMENTS_DIR):
                for name in sorted(os.listdir(EXPERIMENTS_DIR)):
                    meta = read_meta(name)
                    if meta:
                        meta['id'] = name
                        runs = meta.get('runs', [])
                        meta['runCount'] = len(runs)
                        ts = [r.get('created', 0) for r in runs] + [meta.get('created', 0) or 0]
                        meta['lastUpdated'] = max(ts) if ts else 0
                        experiments.append(meta)
            self._send_json(experiments)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            allowed_ext = ('.md', '.ipynb', '.py', '.tex', '.png', '.svg')
            skip_dirs = {'venv', '.kernels', '__pycache__', 'node_modules', '.git'}
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
                    if f.endswith(allowed_ext) and f != 'meta.json':
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
            fname = m.group(2)
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath) or not fname.endswith('.tex'):
                self._send_json({'error': 'Not found'}, 404)
                return
            import subprocess as sp
            tmp = tempfile.mkdtemp()
            try:
                shutil.copy(fpath, os.path.join(tmp, fname))
                # Copy neurips_2023.sty so pdflatex can find it
                sty_path = os.path.join(os.path.dirname(__file__), 'neurips_2023.sty')
                if os.path.isfile(sty_path):
                    shutil.copy(sty_path, tmp)
                result = sp.run(
                    ['pdflatex', '-interaction=nonstopmode', '-halt-on-error', fname],
                    cwd=tmp, capture_output=True, text=True, timeout=30
                )
                pdf_path = os.path.join(tmp, fname.rsplit('.', 1)[0] + '.pdf')
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
            fname = m.group(2)
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
            fname = m.group(2)
            if '..' in fname:
                self._send_json({'error': 'Invalid path'}, 400)
                return
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath):
                self._send_json({'error': 'Not found'}, 404)
                return
            if fname.endswith(('.png', '.svg')):
                import base64
                with open(fpath, 'rb') as f:
                    data = base64.b64encode(f.read()).decode()
                mime = 'image/png' if fname.endswith('.png') else 'image/svg+xml'
                self._send_json({'name': fname, 'content': f'data:{mime};base64,{data}', 'image': True})
            else:
                with open(fpath, 'r') as f:
                    content = f.read()
                self._send_json({'name': fname, 'content': content})

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
            self._send_json(read_todos())

        elif self.path == '/api/calendar':
            self._send_json(read_calendar())

        elif self.path == '/api/blocked-titles':
            self._send_json(read_blocked_titles())

        elif self.path == '/api/quality-prompt':
            self._send_json({
                'prompt': read_prompt(),
                'default': DEFAULT_VERDICT_PROMPT,
                'scoringPrompt': DEFAULT_SCORING_PROMPT
            })

        elif self.path == '/api/saved-posts':
            self._send_json(read_saved_posts())

        elif self.path == '/api/settings':
            self._send_json(read_settings())

        elif self.path.startswith('/api/comments'):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            paper_link = qs.get('paperLink', [''])[0].strip()
            all_comments = read_comments()
            if paper_link:
                filtered = [c for c in all_comments if c.get('paperLink') == paper_link]
            else:
                filtered = all_comments
            self._send_json(filtered)

        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/citations':
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
                if url in _insights_cache:
                    self._send_json(_insights_cache[url])
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

                # 1. Extract repo URLs
                repo_pattern = re.compile(
                    r'https?://(?:github\.com|gitlab\.com|huggingface\.co|bitbucket\.org)'
                    r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_./-]*)?'
                )
                context_pattern = re.compile(
                    r'(?:code|implementation|source|repository|available|released|open[- ]?source)[^.]*?(https?://(?:github\.com|gitlab\.com|huggingface\.co|bitbucket\.org)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)',
                    re.IGNORECASE
                )
                raw_urls = repo_pattern.findall(text)
                # Deduplicate, normalize: strip trailing slashes and common suffixes
                seen = {}
                repos = []
                for u in raw_urls:
                    u = u.rstrip('/')
                    # Remove trailing punctuation that got captured
                    u = re.sub(r'[.,;:)\]]+$', '', u)
                    # Normalize to base repo (user/repo)
                    parts = u.split('/')
                    # At minimum: https://github.com/user/repo = 5 parts
                    if len(parts) >= 5:
                        base = '/'.join(parts[:5])
                    else:
                        base = u
                    if base not in seen:
                        seen[base] = u
                        repos.append({'url': base, 'context': ''})

                # Add context for URLs mentioned near code-related phrases
                context_matches = context_pattern.findall(text)
                for cm in context_matches:
                    cm_base = '/'.join(cm.rstrip('/').split('/')[:5])
                    for r in repos:
                        if r['url'] == cm_base and not r['context']:
                            r['context'] = 'Code repository'

                # 2. Extract 3 key insights: contribution, result, method
                insight_categories = {
                    'Contribution': [
                        'we propose', 'we introduce', 'we present',
                        'our contribution', 'main contribution', 'key contribution',
                        'in this paper, we', 'in this work, we',
                        'this paper presents', 'this paper introduces',
                        'this work presents', 'this paper proposes',
                        'purpose of this paper', 'goal of this paper',
                        'aim of this paper', 'purpose of this work',
                        'goal of this work', 'we develop', 'we design',
                    ],
                    'Result': [
                        'we show that', 'we demonstrate that', 'we prove that',
                        'our results show', 'our experiments show',
                        'we find that', 'we found that', 'results demonstrate',
                        'we observe that', 'we achieve', 'achieves state-of-the-art',
                        'outperforms', 'our approach achieves', 'we obtain',
                        'experiments demonstrate', 'results indicate',
                        'we report', 'leads to significant',
                    ],
                    'Method': [
                        'our method', 'the proposed method', 'our approach',
                        'we use a', 'we employ', 'we leverage',
                        'we train', 'we fine-tune', 'we combine',
                        'our framework', 'our model', 'our system',
                        'our architecture', 'we formulate', 'we build on',
                        'we extend', 'our technique', 'our algorithm',
                    ],
                }
                # Normalize text: collapse newlines within sentences for PDF text
                normalized = re.sub(r'(?<![.!?\n])\n(?![A-Z\n])', ' ', text)
                normalized = re.sub(r'  +', ' ', normalized)
                # Split into sentences
                sentences = re.split(r'(?<=[.!?])\s+', normalized)
                early_text_len = 5000

                insights = []
                used_sentences = set()
                for category, trigger_phrases in insight_categories.items():
                    candidates = []
                    char_pos = 0
                    for s in sentences:
                        s_clean = ' '.join(s.split())
                        s_lower = s_clean.lower()
                        # Skip very short sentences or lines that look like titles/author lists
                        if len(s_clean) < 40 or s_clean.count(',') > 6:
                            char_pos += len(s) + 1
                            continue
                        for phrase in trigger_phrases:
                            if phrase in s_lower:
                                trimmed = s_clean[:300]
                                if len(s_clean) > 300:
                                    trimmed = trimmed.rsplit(' ', 1)[0] + '...'
                                weight = 2 if char_pos < early_text_len else 1
                                candidates.append((weight, char_pos, trimmed))
                                break
                        char_pos += len(s) + 1
                    if candidates:
                        candidates.sort(key=lambda x: (-x[0], x[1]))
                        # Pick best candidate not already used
                        for _, _, text_candidate in candidates:
                            if text_candidate not in used_sentences:
                                insights.append({'label': category, 'text': text_candidate})
                                used_sentences.add(text_candidate)
                                break

                result = {'repos': repos, 'insights': insights}
                _insights_cache[url] = result
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
            allowed_ext = ('.md', '.ipynb', '.py', '.tex', '.png', '.svg')
            if not name or not any(name.endswith(e) for e in allowed_ext):
                self._send_json({'error': f'Name must end with {", ".join(allowed_ext)}'}, 400)
                return
            fpath = os.path.join(exp_dir, name)
            if os.path.exists(fpath):
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
            elif name.endswith('.tex'):
                template_path = os.path.join(os.path.dirname(__file__), 'neurips_2023.tex')
                if os.path.isfile(template_path):
                    shutil.copy(template_path, fpath)
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

        elif self.path == '/api/experiments':
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
            meta['id'] = slug
            self._send_json(meta, 201)

        elif self.path == '/api/todos':
            body = self._read_body()
            title = body.get('title', '').strip()
            if not title:
                self._send_json({'error': 'title required'}, 400)
                return
            todo = {
                'id': str(uuid.uuid4()),
                'title': title,
                'done': False,
                'date': body.get('date', ''),
                'description': body.get('description', ''),
                'content': body.get('content', ''),
                'color': body.get('color', '#b4451a'),
                'experimentId': body.get('experimentId', None),
                'paperLink': body.get('paperLink', None)
            }
            todos = read_todos()
            todos.append(todo)
            write_todos(todos)
            self._send_json(todo, 201)

        elif self.path == '/api/calendar':
            body = self._read_body()
            title = body.get('title', '').strip()
            if not title:
                self._send_json({'error': 'title required'}, 400)
                return
            event = {
                'id': str(uuid.uuid4()),
                'title': title,
                'date': body.get('date', ''),
                'description': body.get('description', ''),
                'color': body.get('color', '#b4451a')
            }
            events = read_calendar()
            events.append(event)
            write_calendar(events)
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

        elif self.path == '/api/comments':
            body = self._read_body()
            paper_link = body.get('paperLink', '').strip()
            author = body.get('author', '').strip()
            content = body.get('content', '').strip()
            if not paper_link or not content:
                self._send_json({'error': 'paperLink and content required'}, 400)
                return
            comment = {
                'id': str(uuid.uuid4()),
                'paperLink': paper_link,
                'author': author or 'Anonymous',
                'content': content,
                'timestamp': int(time.time() * 1000),
                'parentId': body.get('parentId', None)
            }
            comments = read_comments()
            comments.append(comment)
            write_comments(comments)
            self._send_json(comment, 201)

        elif self.path == '/api/saved-posts':
            body = self._read_body()
            url = body.get('url', '').strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            saved = read_saved_posts()
            if url in saved:
                self._send_json({'ok': True, 'exists': True})
                return
            paper = {
                'link': url,
                'title': body.get('title', url),
                'source': body.get('source', 'web'),
                'description': body.get('description', ''),
                'favicon': body.get('favicon', ''),
                'hostname': body.get('hostname', ''),
                'authors': '',
                'categories': [],
                'arxivId': None,
                'date': ''
            }
            saved[url] = {
                'paper': paper,
                'savedAt': int(time.time() * 1000),
                'read': False
            }
            write_saved_posts(saved)
            self._send_json({'ok': True})

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_PUT(self):
        if m := self._match(r'^/api/todos/([a-zA-Z0-9_-]+)$'):
            tid = m.group(1)
            body = self._read_body()
            todos = read_todos()
            for todo in todos:
                if todo['id'] == tid:
                    for key in ('title', 'done', 'date', 'description', 'color', 'experimentId', 'content', 'paperLink'):
                        if key in body:
                            todo[key] = body[key]
                    write_todos(todos)
                    self._send_json(todo)
                    return
            self._send_json({'error': 'Not found'}, 404)
            return

        if m := self._match(r'^/api/calendar/([a-zA-Z0-9_-]+)$'):
            eid = m.group(1)
            body = self._read_body()
            events = read_calendar()
            for ev in events:
                if ev['id'] == eid:
                    for key in ('title', 'date', 'description', 'color'):
                        if key in body:
                            ev[key] = body[key]
                    write_calendar(events)
                    self._send_json(ev)
                    return
            self._send_json({'error': 'Not found'}, 404)
            return

        if self.path == '/api/quality-prompt':
            body = self._read_body()
            prompt = body.get('prompt', '')
            write_prompt(prompt)
            self._send_json({'ok': True, 'prompt': read_prompt()})
            return

        if self.path == '/api/settings':
            body = self._read_body()
            settings = read_settings()
            settings.update(body)
            write_settings(settings)
            self._send_json(settings)
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
            fname = m.group(2)
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

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_DELETE(self):
        if m := self._match(r'^/api/todos/([a-zA-Z0-9_-]+)$'):
            tid = m.group(1)
            todos = read_todos()
            new_todos = [t for t in todos if t['id'] != tid]
            if len(new_todos) == len(todos):
                self._send_json({'error': 'Not found'}, 404)
                return
            write_todos(new_todos)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/calendar/([a-zA-Z0-9_-]+)$'):
            eid = m.group(1)
            events = read_calendar()
            new_events = [e for e in events if e['id'] != eid]
            if len(new_events) == len(events):
                self._send_json({'error': 'Not found'}, 404)
                return
            write_calendar(new_events)
            self._send_json({'ok': True})

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
            fname = m.group(2)
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

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/kernel$'):
            exp_id = m.group(1)
            _kill_kernel(exp_id)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
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
            cid = m.group(1)
            comments = read_comments()
            # Remove the comment and any replies to it
            to_remove = {cid}
            changed = True
            while changed:
                changed = False
                for c in comments:
                    if c.get('parentId') in to_remove and c['id'] not in to_remove:
                        to_remove.add(c['id'])
                        changed = True
            new_comments = [c for c in comments if c['id'] not in to_remove]
            if len(new_comments) == len(comments):
                self._send_json({'error': 'Not found'}, 404)
                return
            write_comments(new_comments)
            self._send_json({'ok': True})

        elif self.path == '/api/saved-posts':
            body = self._read_body()
            url = body.get('url', '').strip()
            if not url:
                self._send_json({'error': 'url required'}, 400)
                return
            saved = read_saved_posts()
            if url in saved:
                del saved[url]
                write_saved_posts(saved)
            self._send_json({'ok': True})

        else:
            self._send_json({'error': 'Not found'}, 404)


print(f'Serving at http://localhost:{PORT}')
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
            self.shutdown_request(request)
    def process_request(self, request, client_address):
        import threading
        t = threading.Thread(target=self.process_request_thread, args=(request, client_address))
        t.daemon = True
        t.start()

ThreadingHTTPServer(('', PORT), Handler).serve_forever()
