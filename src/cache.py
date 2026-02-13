"""Caching layer - in-memory cache, disk cache, feed cache, quality cache, smart highlights."""

import os
import json
import hashlib
import time
import ssl
import urllib.request

from db import DIR, _get_db

# ── Cache constants ──

CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, timestamp)
_cache = {}

# Disk-backed feed cache shared across all users / server restarts
FEED_CACHE_DIR = os.path.join(DIR, 'feed_cache')
os.makedirs(FEED_CACHE_DIR, exist_ok=True)

SAVED_CONTENT_DIR = os.path.join(DIR, 'saved_content')
os.makedirs(SAVED_CONTENT_DIR, exist_ok=True)


# ── Saved content cache (disk) ──

def _content_path(url):
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    return os.path.join(SAVED_CONTENT_DIR, h + '.json')


def read_saved_content(url):
    path = _content_path(url)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return None


def write_saved_content(url, data):
    path = _content_path(url)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


# ── Feed cache (disk) ──

def _feed_cache_path(key):
    """Return path for a disk-cached feed entry."""
    h = hashlib.sha256(key.encode()).hexdigest()[:16]
    return os.path.join(FEED_CACHE_DIR, h + '.bin')


def _disk_cache_get(key):
    """Read from disk cache. Returns (data_bytes, timestamp) or None."""
    path = _feed_cache_path(key)
    try:
        if not os.path.exists(path):
            return None
        mtime = os.path.getmtime(path)
        if time.time() - mtime >= CACHE_TTL:
            return None
        with open(path, 'rb') as f:
            return f.read(), mtime
    except Exception:
        return None


def _disk_cache_set(key, data):
    """Write data bytes to disk cache."""
    try:
        with open(_feed_cache_path(key), 'wb') as f:
            f.write(data)
    except Exception:
        pass


def cached_fetch(url, timeout=15):
    """Fetch a URL, returning cached bytes if fresh enough.

    Checks in-memory cache first, then disk cache (shared across users
    and server restarts), then fetches from the network.
    """
    now = time.time()
    # 1) In-memory cache
    if url in _cache:
        data, ts = _cache[url]
        if now - ts < CACHE_TTL:
            return data
    # 2) Disk cache
    disk = _disk_cache_get(url)
    if disk:
        data, ts = disk
        _cache[url] = (data, ts)
        return data
    # 3) Network fetch
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    ctx = ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        data = resp.read()
    _cache[url] = (data, now)
    _disk_cache_set(url, data)
    return data


# ── Quality cache (SQLite) ──

def _title_hash(title):
    return hashlib.sha256(title.encode()).hexdigest()[:20]


def quality_cache_get(titles, prompt_hash):
    """Look up cached quality results for a list of titles.
    Returns dict of {title: {verdict, score}} for hits."""
    if not titles:
        return {}
    conn = _get_db()
    results = {}
    for title in titles:
        th = _title_hash(title)
        row = conn.execute(
            "SELECT verdict, score FROM quality_cache WHERE title_hash = ? AND prompt_hash = ?",
            (th, prompt_hash)
        ).fetchone()
        if row:
            results[title] = {'v': row['verdict'], 's': row['score']}
    conn.close()
    return results


def quality_cache_set(entries, prompt_hash):
    """Store quality results. entries = {title: {'v': verdict, 's': score|None}}"""
    if not entries:
        return
    conn = _get_db()
    now = time.time()
    for title, data in entries.items():
        th = _title_hash(title)
        verdict = data.get('v')
        score = data.get('s')
        conn.execute(
            "INSERT OR REPLACE INTO quality_cache (title_hash, prompt_hash, verdict, score, cached_at) VALUES (?, ?, ?, ?, ?)",
            (th, prompt_hash, verdict, score, now)
        )
    conn.commit()
    conn.close()


# ── Smart highlights cache (SQLite) ──

def smart_highlights_get(url):
    """Look up cached smart highlights for a paper URL. Returns parsed JSON or None."""
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:20]
    conn = _get_db()
    row = conn.execute(
        "SELECT highlights_json FROM smart_highlights_cache WHERE url_hash = ?",
        (url_hash,)
    ).fetchone()
    conn.close()
    if row:
        return json.loads(row['highlights_json'])
    return None


def smart_highlights_set(url, data):
    """Store smart highlights for a paper URL."""
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:20]
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO smart_highlights_cache (url_hash, highlights_json, cached_at) VALUES (?, ?, ?)",
        (url_hash, json.dumps(data), time.time())
    )
    conn.commit()
    conn.close()
