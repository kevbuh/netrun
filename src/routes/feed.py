"""Feed routes: /feed, /hn-feed, /polymarket-feed, rss-proxy, arxiv-search, quality-filter, quality-prompt, blocked-titles."""
import concurrent.futures
from routes.common import (
    hashlib, json, re, ssl, time, urllib,
    Blueprint, request, jsonify, Response
)

from helpers import build_arxiv_query
from db import _get_db
from cache import (
    CACHE_TTL, _cache, _disk_cache_get, _disk_cache_set,
    quality_cache_get, quality_cache_set,
    cached_fetch,
)
from annotations import (
    read_blocked_titles, write_blocked_titles,
    read_prompt, write_prompt,
    DEFAULT_VERDICT_PROMPT, DEFAULT_SCORING_PROMPT,
    classify_title,
)
from feed_poller import poll_custom_feeds

bp = Blueprint('feed', __name__)


@bp.route('/feed')
def arxiv_feed():
    try:
        data = cached_fetch('https://rss.arxiv.org/rss/cs')
        return Response(data, content_type='application/xml')
    except Exception as e:
        return Response(str(e), status=502, content_type='text/plain')


@bp.route('/hn-feed')
def hn_feed():
    try:
        cache_key = 'hn-feed-v1'
        now = time.time()
        cached = None
        if cache_key in _cache and now - _cache[cache_key][1] < CACHE_TTL:
            cached = _cache[cache_key][0]
        else:
            disk = _disk_cache_get(cache_key)
            if disk:
                cached = disk[0]
                _cache[cache_key] = disk

        if cached:
            stories = json.loads(cached)
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
            data = json.dumps(stories).encode()
            _cache[cache_key] = (data, now)
            _disk_cache_set(cache_key, data)
        return jsonify(stories)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/polymarket-feed')
def polymarket_feed():
    try:
        html = cached_fetch('https://polymarket.com/breaking', timeout=15)
        html_str = html.decode('utf-8', errors='replace')
        marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">'
        idx = html_str.find(marker)
        if idx == -1:
            return jsonify({'error': 'Could not find data'}), 502
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
        return jsonify(top5)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/rss-proxy')
def rss_proxy():
    try:
        feed_url = request.args.get('url', '').strip()
        if not feed_url:
            return Response(b'url parameter required', status=400, content_type='text/plain')
        data = cached_fetch(feed_url)
        return Response(data, content_type='application/xml')
    except Exception as e:
        return Response(str(e).encode(), status=502, content_type='text/plain')


@bp.route('/api/arxiv-search')
def arxiv_search():
    try:
        query = request.args.get('q', '').strip()
        start = int(request.args.get('start', '0'))
        max_results = int(request.args.get('max_results', '20'))
        if not query:
            return jsonify({'error': 'Query required'}), 400
        arxiv_query = build_arxiv_query(query)
        search_url = (
            f'https://export.arxiv.org/api/query?'
            f'search_query={urllib.request.quote(arxiv_query)}'
            f'&start={start}&max_results={max_results}'
            f'&sortBy=relevance&sortOrder=descending'
        )
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            data = resp.read()
        return Response(data, content_type='application/xml')
    except Exception as e:
        return Response(str(e).encode(), status=502, content_type='text/plain')


@bp.route('/api/quality-filter', methods=['POST'])
def quality_filter():
    try:
        body = request.get_json(force=True, silent=True) or {}
        titles = body.get('titles', [])
        mode = body.get('mode', 'verdict')
        if not titles:
            return jsonify({'error': 'titles required'}), 400

        if mode == 'score':
            interest_context = body.get('interest_context', '').strip()[:500]
            score_system = DEFAULT_SCORING_PROMPT
            if interest_context:
                score_system += (
                    "\n\nThe reader's interests: " + interest_context +
                    "\nBoost scores for content matching these interests, but still score objectively."
                )
            prompt_hash = hashlib.sha256(score_system.encode()).hexdigest()[:16]
            cached = quality_cache_get(titles, prompt_hash)
            results = {}
            uncached = []
            for t in titles:
                if t in cached and cached[t].get('s') is not None:
                    results[t] = cached[t]['s']
                else:
                    uncached.append(t)

            if uncached:

                def score_title(title):
                    payload = json.dumps({
                        "model": "qwen3:8b",
                        "messages": [
                            {"role": "system", "content": score_system},
                            {"role": "user", "content": title}
                        ],
                        "stream": False,
                        "think": False,
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

                new_entries = {}
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                    futures = {pool.submit(score_title, t): t for t in uncached}
                    for fut in concurrent.futures.as_completed(futures):
                        t = futures[fut]
                        try:
                            s = fut.result()
                        except Exception:
                            s = 50
                        results[t] = s
                        new_entries[t] = {'s': s}
                quality_cache_set(new_entries, prompt_hash)

            return jsonify(results)
        else:
            custom_prompt = body.get('prompt', '')
            system_msg = custom_prompt.strip() if custom_prompt.strip() else None
            prompt_hash = hashlib.sha256(
                (system_msg or DEFAULT_VERDICT_PROMPT).encode()
            ).hexdigest()[:16]

            cached = quality_cache_get(titles, prompt_hash)
            results = {}
            uncached = []
            for t in titles:
                if t in cached and cached[t].get('v') is not None:
                    results[t] = cached[t]['v']
                else:
                    uncached.append(t)

            if uncached:
                new_entries = {}
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                    futures = {pool.submit(classify_title, t, system_msg): t for t in uncached}
                    for fut in concurrent.futures.as_completed(futures):
                        t = futures[fut]
                        try:
                            v = fut.result()
                        except Exception:
                            v = "keep"
                        results[t] = v
                        new_entries[t] = {'v': v}
                quality_cache_set(new_entries, prompt_hash)

            return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/quality-prompt')
def get_quality_prompt():
    return jsonify({
        'prompt': read_prompt(),
        'default': DEFAULT_VERDICT_PROMPT,
        'scoringPrompt': DEFAULT_SCORING_PROMPT
    })


@bp.route('/api/quality-prompt', methods=['PUT'])
def put_quality_prompt():
    body = request.get_json(force=True, silent=True) or {}
    prompt = body.get('prompt', '')
    write_prompt(prompt)
    return jsonify({'ok': True, 'prompt': read_prompt()})


@bp.route('/api/blocked-titles')
def get_blocked_titles():
    return jsonify(read_blocked_titles())


@bp.route('/api/blocked-titles', methods=['POST'])
def post_blocked_title():
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    if not title:
        return jsonify({'error': 'title required'}), 400
    titles = read_blocked_titles()
    if title not in titles:
        titles.append(title)
        write_blocked_titles(titles)
    return jsonify({'ok': True})


@bp.route('/api/blocked-titles', methods=['DELETE'])
def delete_blocked_titles():
    write_blocked_titles([])
    return jsonify({'ok': True})


@bp.route('/api/models')
def list_models():
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        models = [m['name'] for m in data.get('models', [])]
        return jsonify({'models': models})
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/feed-items')
def get_feed_items():
    """Return feed items from the DB for the requested sources."""
    sources_param = request.args.get('sources', '').strip()
    limit = min(int(request.args.get('limit', '500')), 1000)
    if not sources_param:
        return jsonify([])
    source_keys = [s.strip() for s in sources_param.split(',') if s.strip()]
    if not source_keys:
        return jsonify([])

    conn = _get_db()
    placeholders = ','.join('?' for _ in source_keys)
    rows = conn.execute(
        f'SELECT * FROM feed_items WHERE source IN ({placeholders}) ORDER BY pub_date DESC LIMIT ?',
        source_keys + [limit]
    ).fetchall()
    conn.close()

    items = []
    for row in rows:
        item = {
            'source': row['source'],
            'title': row['title'],
            'link': row['link'],
            'authors': row['authors'],
            'categories': json.loads(row['categories']) if row['categories'] else [],
            'description': row['description'] or '',
            'date': row['display_date'] or '',
            'pubDate': row['pub_date'] or '',
            'arxivId': row['arxiv_id'],
        }
        # Merge extra fields (hnScore, polyYesPct, etc.) into top level
        extra = json.loads(row['extra']) if row['extra'] else {}
        item.update(extra)
        items.append(item)
    return jsonify(items)


@bp.route('/api/feed-items/custom', methods=['POST'])
def get_custom_feed_items():
    """Fetch/store custom user RSS feeds on demand, return items."""
    body = request.get_json(force=True, silent=True) or {}
    feeds = body.get('feeds', [])
    if not feeds:
        return jsonify([])

    # Check what we already have in DB with recent fetched_at
    conn = _get_db()
    cutoff = time.time() - CACHE_TTL
    results = []
    to_fetch = []

    for f in feeds:
        name = f.get('name', f.get('url', ''))
        source_key = f'custom:{name}'
        rows = conn.execute(
            'SELECT COUNT(*) as cnt FROM feed_items WHERE source = ? AND fetched_at > ?',
            (source_key, cutoff)
        ).fetchone()
        if rows['cnt'] > 0:
            # Already have fresh data
            items = conn.execute(
                'SELECT * FROM feed_items WHERE source = ? ORDER BY pub_date DESC LIMIT 100',
                (source_key,)
            ).fetchall()
            for row in items:
                item = {
                    'source': row['source'],
                    'title': row['title'],
                    'link': row['link'],
                    'authors': row['authors'],
                    'categories': json.loads(row['categories']) if row['categories'] else [],
                    'description': row['description'] or '',
                    'date': row['display_date'] or '',
                    'pubDate': row['pub_date'] or '',
                    'arxivId': row['arxiv_id'],
                }
                extra = json.loads(row['extra']) if row['extra'] else {}
                item.update(extra)
                results.append(item)
        else:
            to_fetch.append(f)
    conn.close()

    # Fetch any missing custom feeds
    if to_fetch:
        new_items = poll_custom_feeds(to_fetch)
        for item in new_items:
            result = {
                'source': item['source'],
                'title': item['title'],
                'link': item['link'],
                'authors': item.get('authors', ''),
                'categories': item.get('categories', []),
                'description': item.get('description', ''),
                'date': item.get('display_date', ''),
                'pubDate': item.get('pub_date', ''),
                'arxivId': item.get('arxiv_id'),
            }
            extra = item.get('extra', {})
            result.update(extra)
            results.append(result)

    return jsonify(results)
