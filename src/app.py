#!/usr/bin/env python3
"""Aether server — Flask-based."""
import argparse
import json
import os
import sys

# Parse args before importing persistence so ARXIV_DATA_DIR is set
_parser = argparse.ArgumentParser(description='Aether server')
_parser.add_argument('--port', type=int, default=8000, help='Port to listen on')
_parser.add_argument('--data-dir', default=None, help='Directory for user data (DB, experiments, etc.)')
_parser.add_argument('--static-dir', default=None, help='Directory for static files to serve')
_args = _parser.parse_args()

if _args.data_dir:
    os.environ['ARXIV_DATA_DIR'] = _args.data_dir

from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_sock import Sock

from persistence import DIR, EXPERIMENTS_DIR

# Auto-create _unstructured pseudo-experiment for loose files
_unstructured_dir = os.path.join(EXPERIMENTS_DIR, '_unstructured')
os.makedirs(_unstructured_dir, exist_ok=True)
_unstructured_meta = os.path.join(_unstructured_dir, 'meta.json')
if not os.path.isfile(_unstructured_meta):
    with open(_unstructured_meta, 'w') as f:
        json.dump({'title': 'Unstructured Files', 'desc': '', 'created': None, 'runs': []}, f)

# Uploads directory for profile pictures and backgrounds
UPLOADS_DIR = os.path.join(DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Create Flask app
app = Flask(__name__, static_folder=None)
CORS(app)
sock = Sock(app)

_static_dir = _args.static_dir or DIR

# Register blueprints
from routes.auth import bp as auth_bp
from routes.feed import bp as feed_bp
from routes.experiments import bp as experiments_bp
from routes.social import bp as social_bp
from routes.content import bp as content_bp
from routes.browse import bp as browse_bp
from routes.vault import bp as vault_bp
from routes.misc import bp as misc_bp

app.register_blueprint(auth_bp)
app.register_blueprint(feed_bp)
app.register_blueprint(experiments_bp)
app.register_blueprint(social_bp)
app.register_blueprint(content_bp)
app.register_blueprint(browse_bp)
app.register_blueprint(vault_bp)
app.register_blueprint(misc_bp)


# ── WebSocket terminal ──

@sock.route('/ws/terminal')
def terminal_ws(ws):
    from flask import request as flask_request
    cwd = flask_request.args.get('cwd')
    if cwd and not os.path.isdir(cwd):
        cwd = None
    from terminal_server import handle_websocket_flask
    handle_websocket_flask(ws, cwd=cwd)


# ── Static file serving ──

@app.route('/favicon.ico')
def favicon():
    favicon_path = os.path.join(_static_dir, 'favicon.png')
    if os.path.exists(favicon_path):
        return send_from_directory(_static_dir, 'favicon.png', mimetype='image/png')
    return '', 404


@app.route('/uploads/<path:filename>')
def serve_uploads(filename):
    return send_from_directory(UPLOADS_DIR, filename)


@app.route('/')
def index():
    return send_from_directory(_static_dir, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    full_path = os.path.join(_static_dir, path)
    if os.path.isfile(full_path):
        return send_from_directory(_static_dir, path)
    # SPA fallback
    return send_from_directory(_static_dir, 'index.html')


if __name__ == '__main__':
    PORT = _args.port
    print(f'Serving at http://localhost:{PORT}')
    app.run(host='0.0.0.0', port=PORT, threaded=True, debug=False)
