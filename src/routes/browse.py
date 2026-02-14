"""Browse routes — most ported to TypeScript IPC handlers.
Only browse-proxy remains (HTML rewriting requires Python utils_persistence)."""
from flask import Blueprint, request, jsonify, Response
from cache import cached_fetch
from utils_persistence import rewrite_proxy_html

bp = Blueprint('browse', __name__)


@bp.route('/api/browse-proxy')
def browse_proxy():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'error': 'Missing url parameter'}), 400
    try:
        data = cached_fetch(url, timeout=20)
        html_str = data.decode('utf-8', errors='replace')
        rewritten = rewrite_proxy_html(html_str, url)
        body = rewritten.encode('utf-8')
        resp = Response(body, content_type='text/html; charset=utf-8')
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 502
