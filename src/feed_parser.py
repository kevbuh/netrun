"""Server-side RSS/Atom/HN/Polymarket parsing.

Mirrors the parsing logic from js/feed.js (parseFeed, fetchGenericRSS,
fetchHNFeed, fetchPolymarketFeed) in Python using stdlib only.
"""
import concurrent.futures
import json
import re
import ssl
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone


def _strip_html(s):
    """Remove HTML tags from a string."""
    return re.sub(r'<[^>]+>', '', s).strip()


def _parse_date(s):
    """Try to parse a date string into an ISO 8601 string. Returns (iso, display) or (None, '')."""
    if not s:
        return None, ''
    s = s.strip()
    for fmt in (
        '%a, %d %b %Y %H:%M:%S %z',    # RFC 822 (RSS)
        '%a, %d %b %Y %H:%M:%S %Z',
        '%Y-%m-%dT%H:%M:%S%z',          # ISO 8601
        '%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%dT%H:%M:%S.%f%z',
        '%Y-%m-%dT%H:%M:%S.%fZ',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d',
    ):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            iso = dt.isoformat()
            display = _format_display_date(dt)
            return iso, display
        except ValueError:
            continue
    return None, ''


def _format_display_date(dt):
    """Format a datetime like the JS formatDate: 'Jan 5' or 'Jan 5, 2024'."""
    now = datetime.now(timezone.utc)
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    m = months[dt.month - 1]
    if dt.year == now.year:
        return f'{m} {dt.day}'
    return f'{m} {dt.day}, {dt.year}'


def _extract_arxiv_id(link):
    m = re.search(r'arxiv\.org/abs/(\d+\.\d+)', link or '')
    return m.group(1) if m else None


def _ns_find(el, tag, namespaces=None):
    """Find element with namespace-aware lookup."""
    if namespaces:
        for prefix, uri in namespaces.items():
            result = el.find(f'{{{uri}}}{tag}')
            if result is not None:
                return result
    return el.find(tag)


# Common XML namespaces
NS = {
    'dc': 'http://purl.org/dc/elements/1.1/',
    'content': 'http://purl.org/rss/1.0/modules/content/',
    'atom': 'http://www.w3.org/2005/Atom',
    'media': 'http://search.yahoo.com/mrss/',
}


def parse_rss(xml_bytes, source_key):
    """Parse RSS 2.0 or Atom feed XML into a list of item dicts."""
    items = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    # Determine feed type
    tag = root.tag.split('}')[-1] if '}' in root.tag else root.tag

    if tag == 'feed':
        # Atom format
        atom_ns = root.tag.replace('feed', '') if '{' in root.tag else ''
        for entry in root.findall(f'{atom_ns}entry'):
            title = ''
            title_el = entry.find(f'{atom_ns}title')
            if title_el is not None and title_el.text:
                title = title_el.text.strip()
            if not title:
                continue

            link = ''
            for link_el in entry.findall(f'{atom_ns}link'):
                href = link_el.get('href', '')
                rel = link_el.get('rel', 'alternate')
                if rel == 'alternate' and href:
                    link = href
                    break
                if href and not link:
                    link = href

            summary_el = entry.find(f'{atom_ns}summary')
            content_el = entry.find(f'{atom_ns}content')
            desc_text = ''
            if summary_el is not None and summary_el.text:
                desc_text = summary_el.text
            elif content_el is not None and content_el.text:
                desc_text = content_el.text

            authors = []
            for author_el in entry.findall(f'{atom_ns}author'):
                name_el = author_el.find(f'{atom_ns}name')
                if name_el is not None and name_el.text:
                    authors.append(name_el.text.strip())

            categories = []
            for cat_el in entry.findall(f'{atom_ns}category'):
                term = cat_el.get('term', '') or (cat_el.text or '').strip()
                if term:
                    categories.append(term)

            pub_el = entry.find(f'{atom_ns}published')
            upd_el = entry.find(f'{atom_ns}updated')
            date_str = ''
            if pub_el is not None and pub_el.text:
                date_str = pub_el.text
            elif upd_el is not None and upd_el.text:
                date_str = upd_el.text

            pub_date, display = _parse_date(date_str)
            clean_desc = _strip_html(desc_text)[:300]

            items.append({
                'source': source_key,
                'title': title,
                'link': link,
                'authors': ', '.join(authors),
                'categories': categories,
                'description': clean_desc,
                'pub_date': pub_date,
                'display_date': display,
                'arxiv_id': _extract_arxiv_id(link),
            })
    else:
        # RSS 2.0 format
        channel = root.find('channel')
        if channel is None:
            channel = root
        for item in channel.findall('.//item'):
            title_el = item.find('title')
            title = title_el.text.strip() if title_el is not None and title_el.text else ''
            if not title:
                continue

            link_el = item.find('link')
            link = ''
            if link_el is not None:
                link = (link_el.text or '').strip()
                if not link:
                    link = link_el.get('href', '')

            desc_el = item.find('description')
            if desc_el is None:
                desc_el = item.find(f'{{{NS["content"]}}}encoded')
            desc_text = desc_el.text if desc_el is not None and desc_el.text else ''

            creator_el = item.find(f'{{{NS["dc"]}}}creator')
            author_el = item.find('author')
            author = ''
            if creator_el is not None and creator_el.text:
                author = creator_el.text.strip()
            elif author_el is not None and author_el.text:
                author = author_el.text.strip()

            categories = []
            for cat_el in item.findall('category'):
                text = (cat_el.text or '').strip()
                if text:
                    categories.append(text)

            pub_el = item.find('pubDate')
            date_str = pub_el.text if pub_el is not None and pub_el.text else ''
            pub_date, display = _parse_date(date_str)

            clean_desc = _strip_html(desc_text)
            # Clean arXiv-specific prefix
            clean_desc = re.sub(
                r'^arXiv:\S+\s+Announce Type:\s*\w+\s+Abstract:\s*',
                '', clean_desc, flags=re.IGNORECASE
            ).strip()[:300]

            comments_el = item.find('comments')
            extra = {}
            if comments_el is not None and comments_el.text:
                extra['commentsUrl'] = comments_el.text.strip()

            items.append({
                'source': source_key,
                'title': title,
                'link': link,
                'authors': author,
                'categories': categories,
                'description': clean_desc,
                'pub_date': pub_date,
                'display_date': display,
                'arxiv_id': _extract_arxiv_id(link),
                'extra': extra,
            })

    return items


def parse_arxiv(xml_bytes):
    """Parse arXiv RSS feed, extracting arxiv IDs."""
    return parse_rss(xml_bytes, 'arxiv')


def fetch_and_parse_hn():
    """Fetch top 30 HN stories and return as item dicts."""
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(
        'https://hacker-news.firebaseio.com/v0/beststories.json',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        ids = json.loads(resp.read())[:30]

    def fetch_item(item_id):
        url = f'https://hacker-news.firebaseio.com/v0/item/{item_id}.json'
        r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(r, timeout=10, context=ctx) as resp:
            return json.loads(resp.read())

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        raw = list(pool.map(fetch_item, ids))

    items = []
    for s in raw:
        if not s or s.get('type') != 'story':
            continue
        url = s.get('url') or f'https://news.ycombinator.com/item?id={s["id"]}'
        ts = datetime.fromtimestamp(s['time'], tz=timezone.utc) if s.get('time') else None
        pub_date = ts.isoformat() if ts else None
        display = _format_display_date(ts) if ts else ''
        items.append({
            'source': 'hn',
            'title': s.get('title', ''),
            'link': url,
            'authors': s.get('by', ''),
            'categories': [],
            'description': '',
            'pub_date': pub_date,
            'display_date': display,
            'arxiv_id': None,
            'extra': {
                'hnScore': s.get('score', 0),
                'hnComments': s.get('descendants', 0),
                'hnId': s.get('id'),
            },
        })
    return items


def fetch_and_parse_polymarket():
    """Fetch Polymarket breaking data and return as item dicts."""
    ctx = ssl._create_unverified_context()
    req = urllib.request.Request(
        'https://polymarket.com/breaking',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        html = resp.read().decode('utf-8', errors='replace')

    marker = '__NEXT_DATA__" type="application/json" crossorigin="anonymous">'
    idx = html.find(marker)
    if idx == -1:
        return []
    start = idx + len(marker)
    end = html.find('</script>', start)
    next_data = json.loads(html[start:end])
    queries = next_data['props']['pageProps']['dehydratedState']['queries']
    markets = []
    for q in queries:
        key = q.get('queryKey', [])
        if 'biggest-movers' in key:
            markets = q['state']['data'].get('markets', [])
            break

    items = []
    now = datetime.now(timezone.utc).isoformat()
    for m in markets:
        slug = m.get('slug', '')
        prices = m.get('outcomePrices', ['0', '0'])
        yes_pct = round(float(prices[0]) * 100)
        change = m.get('oneDayPriceChange', 0)
        change_pct = round(change * 100)
        volume = 0
        if m.get('events'):
            volume = round(m['events'][0].get('volume', 0))
        event_slug = m['events'][0]['slug'] if m.get('events') else slug
        url = f'https://polymarket.com/event/{event_slug}'
        sign = '+' if change_pct >= 0 else ''
        items.append({
            'source': 'polymarket',
            'title': m.get('question', ''),
            'link': url,
            'authors': '',
            'categories': ['Prediction Markets'],
            'description': f'{yes_pct}% Yes \u00b7 {sign}{change_pct}% today \u00b7 ${volume:,} volume',
            'pub_date': now,
            'display_date': 'live',
            'arxiv_id': None,
            'extra': {
                'polyYesPct': yes_pct,
                'polyChangePct': change_pct,
                'polyVolume': volume,
                'polyImage': m.get('image', ''),
                'polySlug': slug,
            },
        })
    return items
