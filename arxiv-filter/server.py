#!/usr/bin/env python3
import http.server
import urllib.request
import ssl
import os
import json
import re
import shutil
import time
import concurrent.futures

PORT = 8000
CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, content_type, timestamp)
_cache = {}
DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENTS_DIR = os.path.join(DIR, 'experiments')

os.makedirs(EXPERIMENTS_DIR, exist_ok=True)


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
                if not titles:
                    self._send_json({'error': 'titles required'}, 400)
                    return
                default_prompt = (
                    "Classify as KEEP or SKIP. One word only.\n\n"
                    "KEEP = research, engineering, science, deep analysis, novel projects, thoughtful essays\n"
                    "SKIP = listicles, ragebait, marketing, job posts, fluff, vague announcements, politics\n\n"
                    "Title: \"{title}\"\nAnswer:"
                )
                prompt_tpl = body.get('prompt', default_prompt)
                if '{title}' not in prompt_tpl:
                    prompt_tpl = default_prompt
                results = {}
                # Process titles in parallel with ThreadPoolExecutor
                def classify(title):
                    payload = json.dumps({
                        "model": "qwen2.5:0.5b",
                        "prompt": prompt_tpl.format(title=title.replace('"', '\\"')),
                        "stream": False,
                        "options": {"temperature": 0, "num_predict": 3}
                    }).encode()
                    req = urllib.request.Request(
                        "http://localhost:11434/api/generate",
                        data=payload,
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        resp_data = json.loads(resp.read())
                    answer = resp_data.get("response", "").strip().upper()
                    return "keep" if answer.startswith("KEEP") else "skip"

                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                    futures = {pool.submit(classify, t): t for t in titles}
                    for fut in concurrent.futures.as_completed(futures):
                        t = futures[fut]
                        try:
                            results[t] = fut.result()
                        except Exception:
                            results[t] = "keep"  # default to keep on error

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
        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_PUT(self):
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
        if m := self._match(r'^/api/experiments/([a-zA-Z0-9_-]+)/files/(.+\.(?:md|ipynb))$'):
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
        else:
            self._send_json({'error': 'Not found'}, 404)


print(f'Serving at http://localhost:{PORT}')
http.server.HTTPServer(('', PORT), Handler).serve_forever()
