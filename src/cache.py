"""Caching layer - in-memory + disk cache for HTTP fetches."""

import os
import time
import hashlib
import urllib.request

from db import DIR
from routes.common import get_ssl_context

# ── Cache constants ──

CACHE_TTL = 600  # 10 minutes

# In-memory cache: url -> (data_bytes, timestamp)
_cache = {}

# Disk-backed feed cache shared across all users / server restarts
FEED_CACHE_DIR = os.path.join(DIR, 'feed_cache')
os.makedirs(FEED_CACHE_DIR, exist_ok=True)


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
    ctx = get_ssl_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        data = resp.read()
    _cache[url] = (data, now)
    _disk_cache_set(url, data)
    return data
