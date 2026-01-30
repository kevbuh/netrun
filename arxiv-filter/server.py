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
DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')
CALENDAR_FILE = os.path.join(DIR, 'calendar.json')
TODOS_FILE = os.path.join(DIR, 'todos.json')
SAVED_POSTS_FILE = os.path.join(DIR, 'saved_posts.json')
SETTINGS_FILE = os.path.join(DIR, 'settings.json')

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
        km.start_kernel()
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
                search_url = (
                    f'https://export.arxiv.org/api/query?'
                    f'search_query=all:{urllib.request.quote(query)}'
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
            files = [f for f in os.listdir(exp_dir) if f.endswith(('.md', '.ipynb', '.py', '.png', '.svg')) and f != 'meta.json']
            files.sort()
            self._send_json(files)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+)$'):
            exp_id = m.group(1)
            fname = m.group(2)
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

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            name = body.get('name', '').strip()
            allowed_ext = ('.md', '.ipynb', '.py', '.png', '.svg')
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
                'experimentId': body.get('experimentId', None)
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
                    for key in ('title', 'done', 'date', 'description', 'color', 'experimentId', 'content'):
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
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            # Rename if 'rename' field is provided
            if 'rename' in body:
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
