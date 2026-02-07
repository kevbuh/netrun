"""Browse routes: web-search, check-embed, link-preview, browse-proxy, image-proxy, stock-quote, adblock."""
import json
import os
import re
import ssl
import urllib.request

from flask import Blueprint, request, jsonify, Response

from persistence import DIR, cached_fetch, get_adblock_stats, update_adblock_lists, clean_html

bp = Blueprint('browse', __name__)


@bp.route('/api/web-search')
def web_search():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'results': []})
    try:
        from persistence import log_usage
        log_usage('search_chat')
    except Exception:
        pass
    try:
        search_url = 'https://html.duckduckgo.com/html/?q=' + urllib.request.quote(query)
        req = urllib.request.Request(search_url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            html = resp.read().decode('utf-8', errors='replace')
        results = []
        title_pattern = re.compile(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL)
        snippet_pattern = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL)
        titles = title_pattern.findall(html)
        snippets = snippet_pattern.findall(html)
        for i, (url, title) in enumerate(titles[:8]):
            clean_title = re.sub(r'<[^>]+>', '', title).strip()
            snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ''
            if 'uddg=' in url:
                actual = re.search(r'uddg=([^&]+)', url)
                if actual:
                    url = urllib.request.unquote(actual.group(1))
            results.append({'title': clean_title, 'url': url, 'snippet': snippet})
        return jsonify({'results': results})
    except Exception as e:
        return jsonify({'results': [], 'error': str(e)})


@bp.route('/api/check-embed')
def check_embed():
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({'embeddable': False})
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            xfo = (resp.headers.get('X-Frame-Options') or '').upper()
            csp = resp.headers.get('Content-Security-Policy') or ''
            blocked = bool(xfo) or 'frame-ancestors' in csp
            return jsonify({'embeddable': not blocked})
    except Exception:
        return jsonify({'embeddable': False})


@bp.route('/api/link-preview')
def link_preview():
    from urllib.parse import urlparse
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
            raw = resp.read(200_000)
            html = raw.decode('utf-8', errors='replace')

        def meta(prop):
            for attr in ('property', 'name'):
                m = re.search(rf'<meta\s+{attr}="{re.escape(prop)}"\s+content="([^"]*)"', html, re.I)
                if m:
                    return m.group(1)
                m = re.search(rf'<meta\s+content="([^"]*)"\s+{attr}="{re.escape(prop)}"', html, re.I)
                if m:
                    return m.group(1)
            return ''

        title = meta('og:title') or meta('twitter:title')
        if not title:
            m = re.search(r'<title[^>]*>(.*?)</title>', html, re.I | re.DOTALL)
            title = re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else ''
        desc = meta('og:description') or meta('twitter:description') or meta('description')
        image = meta('og:image') or meta('twitter:image')
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
        return jsonify({
            'title': title[:200],
            'description': desc[:300],
            'image': image,
            'site': site or domain,
            'favicon': favicon,
            'domain': domain
        })
    except Exception as e:
        return jsonify({'title': '', 'description': '', 'image': '', 'site': '', 'domain': '', 'error': str(e)})


@bp.route('/api/browse-proxy')
def browse_proxy():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'error': 'Missing url parameter'}), 400
    color_scheme = request.args.get('scheme', '')
    try:
        data = cached_fetch(url, timeout=20)
        html_str = data.decode('utf-8', errors='replace')
        cleaned, count = clean_html(html_str, url, color_scheme=color_scheme)
        body = cleaned.encode('utf-8')
        resp = Response(body, content_type='text/html; charset=utf-8')
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['X-Blocked-Count'] = str(count)
        return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/image-proxy')
def image_proxy():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'error': 'Missing url parameter'}), 400
    try:
        body = cached_fetch(url, timeout=15)
        ext = url.rsplit('.', 1)[-1].lower().split('?')[0] if '.' in url else ''
        ct_map = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                  'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'ico': 'image/x-icon'}
        ct = ct_map.get(ext, 'image/png')
        resp = Response(body, content_type=ct)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/stock-quote')
def stock_quote():
    try:
        symbol = request.args.get('symbol', '').strip().upper()
        if not symbol:
            return jsonify({'error': 'symbol required'}), 400
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
        return jsonify({'price': price, 'change': change, 'changePercent': change_pct, 'name': name})
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/adblock-rules')
def adblock_rules():
    return jsonify(get_adblock_stats())


@bp.route('/api/adblock-rules/reset', methods=['POST'])
def adblock_reset():
    update_adblock_lists()
    return jsonify(get_adblock_stats())


