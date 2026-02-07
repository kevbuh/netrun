"""Background feed poller.

Polls all catalog sources every 10 minutes using a daemon thread.
Stores parsed items in the feed_items SQLite table.
"""
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from feed_catalog import FEED_CATALOG
from feed_parser import parse_rss, parse_arxiv, fetch_and_parse_hn, fetch_and_parse_polymarket
from persistence import cached_fetch, _get_db

logger = logging.getLogger(__name__)

POLL_INTERVAL = 600  # 10 minutes
MAX_AGE = 30 * 24 * 3600  # 30 days

_timer = None


def _store_items(items):
    """Bulk upsert items into feed_items table."""
    if not items:
        return
    conn = _get_db()
    now = time.time()
    for item in items:
        extra = item.get('extra', {})
        try:
            conn.execute(
                """INSERT INTO feed_items
                   (source, title, link, authors, categories, description,
                    pub_date, display_date, arxiv_id, extra, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(source, link) DO UPDATE SET
                     title=excluded.title,
                     authors=excluded.authors,
                     categories=excluded.categories,
                     description=excluded.description,
                     pub_date=excluded.pub_date,
                     display_date=excluded.display_date,
                     arxiv_id=excluded.arxiv_id,
                     extra=excluded.extra,
                     fetched_at=excluded.fetched_at
                """,
                (
                    item['source'],
                    item['title'],
                    item['link'],
                    item.get('authors', ''),
                    json.dumps(item.get('categories', [])),
                    item.get('description', ''),
                    item.get('pub_date'),
                    item.get('display_date', ''),
                    item.get('arxiv_id'),
                    json.dumps(extra),
                    now,
                )
            )
        except Exception as e:
            logger.debug('Error storing item %s: %s', item.get('link', ''), e)
    conn.commit()
    conn.close()


def _fetch_source(entry):
    """Fetch and parse a single catalog source. Returns list of item dicts."""
    key = entry['key']
    special = entry.get('special')
    url = entry.get('url')

    try:
        if special == 'arxiv':
            xml = cached_fetch('https://rss.arxiv.org/rss/cs')
            return parse_arxiv(xml)
        elif special == 'hn':
            return fetch_and_parse_hn()
        elif special == 'polymarket':
            return fetch_and_parse_polymarket()
        elif url:
            xml = cached_fetch(url)
            return parse_rss(xml, key)
        else:
            return []
    except Exception as e:
        logger.debug('Error fetching %s: %s', key, e)
        return []


def _cleanup_old():
    """Delete feed items older than MAX_AGE."""
    cutoff = time.time() - MAX_AGE
    try:
        conn = _get_db()
        conn.execute('DELETE FROM feed_items WHERE fetched_at < ?', (cutoff,))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.debug('Cleanup error: %s', e)


def _poll_cycle():
    """Run one polling cycle: fetch all sources, store items, cleanup."""
    start = time.time()
    total_items = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_source, entry): entry['key'] for entry in FEED_CATALOG}
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                items = fut.result()
                if items:
                    _store_items(items)
                    total_items += len(items)
            except Exception as e:
                logger.debug('Poll error for %s: %s', key, e)

    _cleanup_old()
    elapsed = time.time() - start
    logger.info('Feed poll: %d items from %d sources in %.1fs', total_items, len(FEED_CATALOG), elapsed)


def _poll_loop():
    """Run poll cycle then schedule next one."""
    global _timer
    try:
        _poll_cycle()
    except Exception as e:
        logger.error('Poll cycle failed: %s', e)
    _timer = threading.Timer(POLL_INTERVAL, _poll_loop)
    _timer.daemon = True
    _timer.start()


def start_poller():
    """Start the background feed poller. Call once at app startup."""
    t = threading.Thread(target=_poll_loop, daemon=True)
    t.start()
    logger.info('Feed poller started (interval=%ds)', POLL_INTERVAL)


def poll_custom_feeds(feeds):
    """Fetch and store custom user RSS feeds on demand.

    Args:
        feeds: list of {url, name} dicts
    Returns:
        list of stored item dicts
    """
    all_items = []
    for f in feeds:
        url = f.get('url', '')
        name = f.get('name', url)
        source_key = f'custom:{name}'
        try:
            xml = cached_fetch(url)
            items = parse_rss(xml, source_key)
            if items:
                _store_items(items)
                all_items.extend(items)
        except Exception as e:
            logger.debug('Error fetching custom feed %s: %s', url, e)
    return all_items
