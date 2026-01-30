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
import concurrent.futures

PORT = 8000
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, content_type, timestamp)
_cache = {}
DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')
BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')
CALENDAR_FILE = os.path.join(DIR, 'calendar.json')
TODOS_FILE = os.path.join(DIR, 'todos.json')

os.makedirs(EXPERIMENTS_DIR, exist_ok=True)


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
    "You are a strict topic filter for a CS/science/tech reader.\n\n"
    "KEEP only if the title is clearly about: computer science, programming, software engineering, "
    "math, physics, AI/ML research, systems, algorithms, scientific discoveries, hardware engineering, "
    "databases, networking, security research, open-source projects, developer tools, novel technology.\n\n"
    "SKIP everything else, including: politics, law, lawsuits, courts, government, policy, regulation, "
    "elections, immigration, social issues, business deals, mergers, acquisitions, opinion pieces, "
    "culture war, hiring/jobs, celebrity news, sports, entertainment, lifestyle, marketing, "
    "product reviews, buyer's guides, 'best X' roundups, deals, discounts, coupons, promo codes, "
    "gift guides, gadget reviews, price comparisons, sales, VPN reviews, sleep/health products, "
    "TV/movie/show recommendations, recipes, fashion, travel, real estate, automotive news, "
    "military, war, crime, accidents, weather, animals/wildlife, food/drink.\n\n"
    "When in doubt, SKIP.\n\n"
    "Reply ONLY with KEEP or SKIP."
)


DEFAULT_SCORING_PROMPT = (
    "You are a strict relevance scorer for a CS/science reader.\n\n"
    "10: groundbreaking CS/science research, novel algorithms, breakthrough discoveries.\n"
    "9: significant open-source releases, deep technical write-ups, important papers.\n"
    "8: solid technical content — programming tutorials, developer tools, software architecture, "
    "engineering blog posts, science news reporting.\n"
    "6-7: tangentially technical — tech industry news, startup announcements, conference talks.\n"
    "4-5: barely related — tech business, funding rounds, industry opinions, CEO statements.\n"
    "2-3: off-topic — product reviews, buyer's guides, 'best X' roundups, deals, discounts, "
    "coupons, promo codes, gift guides, gadget comparisons, politics, law, government, "
    "immigration, military, crime, entertainment, lifestyle, sports, celebrity, fashion, "
    "food, travel, health products, VPN/sleep/mattress reviews.\n"
    "1: rage bait, clickbait, outrage headlines, inflammatory takes, culture war, "
    "sensationalized news, misleading titles, engagement farming.\n"
    "0: spam, SEO garbage, auto-generated content, completely irrelevant.\n\n"
    "Be strict. Most general news should score 5 or below.\n\n"
    "Reply with ONLY a number 0-10."
)


def classify_title(title, system_msg=None):
    """Classify a single title as 'keep' or 'skip' via Ollama."""
    if system_msg is None:
        system_msg = DEFAULT_VERDICT_PROMPT
    payload = json.dumps({
        "model": "qwen2.5:1.5b",
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
        self.end_headers()
        self.wfile.write(body)

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
                        exp_dir = os.path.join(EXPERIMENTS_DIR, name)
                        files = [f for f in os.listdir(exp_dir) if f.endswith('.md') or f.endswith('.ipynb')] if os.path.isdir(exp_dir) else []
                        meta['fileCount'] = len(files)
                        meta['mdCount'] = sum(1 for f in files if f.endswith('.md'))
                        meta['nbCount'] = sum(1 for f in files if f.endswith('.ipynb'))
                        experiments.append(meta)
            self._send_json(experiments)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
            meta = read_meta(exp_id)
            if meta:
                meta['id'] = exp_id
                self._send_json(meta)
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            files = [f for f in sorted(os.listdir(exp_dir)) if f.endswith('.md') or f.endswith('.ipynb')]
            self._send_json(files)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+\.(?:md|ipynb))$'):
            exp_id = m.group(1)
            fname = m.group(2)
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if not os.path.isfile(fpath):
                self._send_json({'error': 'Not found'}, 404)
                return
            with open(fpath, 'r') as f:
                content = f.read()
            self._send_json({'name': fname, 'content': content})

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

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            name = body.get('name', '').strip()
            if not name:
                self._send_json({'error': 'Name required'}, 400)
                return
            if not name.endswith('.md') and not name.endswith('.ipynb'):
                name += '.md'
            fname = re.sub(r'[^\w\s.-]', '', name).strip()
            fname = re.sub(r'\s+', '-', fname)
            fpath = os.path.join(exp_dir, fname)
            if os.path.exists(fpath):
                self._send_json({'error': 'File already exists'}, 409)
                return
            with open(fpath, 'w') as f:
                if fname.endswith('.ipynb'):
                    empty_nb = {
                        "nbformat": 4,
                        "nbformat_minor": 5,
                        "metadata": {
                            "kernelspec": {
                                "display_name": "Python 3",
                                "language": "python",
                                "name": "python3"
                            },
                            "language_info": {"name": "python", "version": "3.10.0"}
                        },
                        "cells": [
                            {
                                "cell_type": "code",
                                "source": "",
                                "metadata": {},
                                "outputs": [],
                                "execution_count": None
                            }
                        ]
                    }
                    json.dump(empty_nb, f, indent=2)
                else:
                    f.write('')
            self._send_json({'name': fname}, 201)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/fork$'):
            exp_id = m.group(1)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
            import copy
            new_meta = copy.deepcopy(meta)
            new_meta['title'] = meta['title'] + ' (fork)'
            new_meta['created'] = self._read_body().get('created', None)
            slug = unique_slug(slugify(new_meta['title']))
            exp_dir = os.path.join(EXPERIMENTS_DIR, slug)
            os.makedirs(exp_dir, exist_ok=True)
            for v in new_meta.get('versions', []):
                ver_dir = os.path.join(exp_dir, v['id'])
                os.makedirs(ver_dir, exist_ok=True)
            write_meta(slug, new_meta)
            new_meta['id'] = slug
            self._send_json(new_meta, 201)

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
                            "model": "qwen2.5:1.5b",
                            "messages": [
                                {"role": "system", "content": score_system},
                                {"role": "user", "content": title}
                            ],
                            "stream": False,
                            "options": {"temperature": 0, "num_predict": 6}
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
                        return max(0, min(10, score))

                    results = {}
                    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                        futures = {pool.submit(score_title, t): t for t in titles}
                        for fut in concurrent.futures.as_completed(futures):
                            t = futures[fut]
                            try:
                                results[t] = fut.result()
                            except Exception:
                                results[t] = 70
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
                'versions': []
            }
            write_meta(slug, meta)
            meta['id'] = slug
            self._send_json(meta, 201)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/versions$'):
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

            vid = slugify(name)
            existing_ids = {v['id'] for v in meta.get('versions', [])}
            base_vid = vid
            counter = 2
            while vid in existing_ids:
                vid = f'{base_vid}-{counter}'
                counter += 1

            version = {
                'id': vid,
                'name': name,
                'notes': body.get('notes', ''),
                'status': body.get('status', 'planned'),
                'results': body.get('results', ''),
                'parentId': body.get('parentId', None),
                'created': body.get('created', None)
            }
            meta.setdefault('versions', []).append(version)
            write_meta(exp_id, meta)

            # Create version directory
            ver_dir = os.path.join(EXPERIMENTS_DIR, exp_id, vid)
            os.makedirs(ver_dir, exist_ok=True)

            self._send_json(version, 201)

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
                'color': body.get('color', '#b4451a')
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

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_PUT(self):
        if m := self._match(r'^/api/todos/([a-zA-Z0-9_-]+)$'):
            tid = m.group(1)
            body = self._read_body()
            todos = read_todos()
            for todo in todos:
                if todo['id'] == tid:
                    for key in ('title', 'done', 'date', 'description', 'color'):
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

        if m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+\.(?:md|ipynb))$'):
            exp_id = m.group(1)
            fname = m.group(2)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if not os.path.isdir(exp_dir):
                self._send_json({'error': 'Not found'}, 404)
                return
            body = self._read_body()
            content = body.get('content', '')
            fpath = os.path.join(exp_dir, fname)
            with open(fpath, 'w') as f:
                f.write(content)
            self._send_json({'name': fname, 'ok': True})
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
            write_meta(exp_id, meta)
            meta['id'] = exp_id
            self._send_json(meta)
            return

        m = self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/versions/([a-zA-Z0-9_-]+)$')
        if not m:
            self._send_json({'error': 'Not found'}, 404)
            return
        exp_id, vid = m.group(1), m.group(2)
        meta = read_meta(exp_id)
        if not meta:
            self._send_json({'error': 'Not found'}, 404)
            return
        body = self._read_body()
        for v in meta.get('versions', []):
            if v['id'] == vid:
                for key in ('name', 'notes', 'status', 'results'):
                    if key in body:
                        v[key] = body[key]
                write_meta(exp_id, meta)
                self._send_json(v)
                return
        self._send_json({'error': 'Version not found'}, 404)

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

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+\.(?:md|ipynb))$'):
            exp_id = m.group(1)
            fname = m.group(2)
            fpath = os.path.join(EXPERIMENTS_DIR, exp_id, fname)
            if os.path.isfile(fpath):
                os.remove(fpath)
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/versions/([a-zA-Z0-9_-]+)$'):
            exp_id, vid = m.group(1), m.group(2)
            meta = read_meta(exp_id)
            if not meta:
                self._send_json({'error': 'Not found'}, 404)
                return
            meta['versions'] = [v for v in meta.get('versions', []) if v['id'] != vid]
            write_meta(exp_id, meta)
            ver_dir = os.path.join(EXPERIMENTS_DIR, exp_id, vid)
            if os.path.isdir(ver_dir):
                shutil.rmtree(ver_dir)
            self._send_json({'ok': True})

        elif m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)$'):
            exp_id = m.group(1)
            exp_dir = os.path.join(EXPERIMENTS_DIR, exp_id)
            if os.path.isdir(exp_dir):
                shutil.rmtree(exp_dir)
                self._send_json({'ok': True})
            else:
                self._send_json({'error': 'Not found'}, 404)

        elif self.path == '/api/blocked-titles':
            write_blocked_titles([])
            self._send_json({'ok': True})

        else:
            self._send_json({'error': 'Not found'}, 404)


print(f'Serving at http://localhost:{PORT}')
http.server.HTTPServer(('', PORT), Handler).serve_forever()
