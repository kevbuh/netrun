"""Shared helpers for Flask route handlers: auth decorator, SSE formatting."""
import json
from functools import wraps

from flask import request, jsonify

from users import get_session_user, touch_last_seen


# ── Auth decorator ──

def require_auth(f):
    """Require a valid Bearer token. Passes google_id= to the handler."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Not authenticated'}), 401
        google_id = get_session_user(auth[7:])
        if not google_id:
            return jsonify({'error': 'Invalid session'}), 401
        touch_last_seen(google_id)
        return f(*args, google_id=google_id, **kwargs)
    return decorated


# ── SSE helper ──

def sse_event(event, data):
    """Format a single SSE event string."""
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'
