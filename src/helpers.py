"""Shared helpers for Flask route handlers: auth decorators, SSE, chat tools, arxiv query builder."""
import json
import os
import re
import tempfile
import urllib.request
from functools import wraps

from flask import request, jsonify
from routes.common import get_ssl_context

from users import get_session_user, touch_last_seen
from db import get_vault_project_dir
from utils_persistence import slugify, unique_vault_slug
from cache import cached_fetch


# ── Auth decorators ──

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


def optional_auth(f):
    """Like require_auth but passes google_id=None if not logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        google_id = None
        if auth.startswith('Bearer '):
            google_id = get_session_user(auth[7:])
            if google_id:
                touch_last_seen(google_id)
        return f(*args, google_id=google_id, **kwargs)
    return decorated


def require_experiment_access(f):
    """Require auth + verify project is in user's vault. Passes google_id= and exp_id= to handler."""
    @wraps(f)
    def decorated(exp_id, *args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Not authenticated'}), 401
        google_id = get_session_user(auth[7:])
        if not google_id:
            return jsonify({'error': 'Invalid session'}), 401
        touch_last_seen(google_id)
        exp_dir = get_vault_project_dir(google_id, exp_id)
        if not exp_dir:
            return jsonify({'error': 'Invalid project path'}), 400
        return f(exp_id, *args, google_id=google_id, **kwargs)
    return decorated


def get_user_from_request():
    """Extract google_id from Authorization header. Returns None if not authenticated."""
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        gid = get_session_user(auth[7:])
        if gid:
            touch_last_seen(gid)
        return gid
    return None


# ── SSE helper ──

def sse_event(event, data):
    """Format a single SSE event string."""
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'


# ── arXiv query builder ──

def build_arxiv_query(raw):
    """Build arXiv API search_query from user input.
    Supports: title:"phrase", title:word, "phrase", by:author, bare words.
    Maps to arXiv fields: ti: (title), au: (author), all: (everything)."""
    parts = []
    by_match = re.search(r'\bby:(.+)', raw)
    if by_match:
        author = by_match.group(1).strip()
        if author:
            parts.append(f'au:"{author}"')
        raw = raw[:by_match.start()].strip()
    raw = re.sub(r'title:"([^"]+)"', lambda m: (parts.append(f'ti:"{m.group(1)}"'), '')[1], raw)
    raw = re.sub(r'"([^"]+)"', lambda m: (parts.append(f'all:"{m.group(1)}"'), '')[1], raw)
    tokens = raw.split()
    bare_words = []
    for t in tokens:
        if t.startswith('title:'):
            val = t[6:]
            if val:
                parts.append(f'ti:{val}')
        elif t.startswith('source:') or t.startswith('sort:'):
            continue
        else:
            bare_words.append(t)
    if bare_words:
        phrase = ' '.join(bare_words)
        parts.append(f'all:"{phrase}"')
    return ' AND '.join(parts) if parts else 'all:*'


# ── Chat tool definitions for Ollama tool calling ──

CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web using DuckDuckGo. Returns top results with titles, URLs, and snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_papers",
            "description": "Search for academic papers on arXiv. Returns titles, URLs, authors, and summaries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query for papers"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": "Fetch and extract text content from a URL (web page or PDF).",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_to_reading_list",
            "description": "Bookmark a post or paper to the user's reading list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL of the post to bookmark"},
                    "title": {"type": "string", "description": "Title of the post"}
                },
                "required": ["url", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Switch to a different app section (home, browse, experiments, etc.). This ONLY switches the app panel — it does NOT open websites or URLs. To open a website like youtube.com, use open_tab instead. To add a calendar event, use create_calendar_event instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "view": {"type": "string", "description": "View to navigate to: home, browse, experiments, saved, calendar, settings, quality"}
                },
                "required": ["view"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_experiment",
            "description": "Create a new experiment/project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Title for the experiment"},
                    "description": {"type": "string", "description": "Description of the experiment"}
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_calendar_event",
            "description": "Add an event to the user's calendar. You MUST call this tool — do not just describe the event. Use when the user asks to schedule, remind, or add something to their calendar. Use the current date/time from the system prompt to compute relative times like 'in 5 minutes' or 'tomorrow'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Event title"},
                    "date": {"type": "string", "description": "Event date in YYYY-MM-DD format. Compute from current date in system prompt."},
                    "time": {"type": "string", "description": "Event time in HH:MM format (24h). Compute from current time in system prompt for relative requests like 'in 5 minutes'."},
                    "description": {"type": "string", "description": "Optional event description"}
                },
                "required": ["title", "date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "open_tab",
            "description": "Open a website or URL in a new browser tab. Use this when the user wants to go to a website (e.g. 'go to youtube', 'open google.com'). If the user says 'open a new tab' or 'new tab' without specifying a URL, call this with NO url parameter to open a blank new tab page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "A specific URL to open. Do NOT pass this if the user just wants a blank new tab."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_read_page",
            "description": "Re-read the current page DOM after clicking, typing, or scrolling changed it. Do NOT call this if the DOM is already in your context. Returns elements with numeric IDs for browser_click/browser_type.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click an element on the current page by its numeric ID from browser_read_page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "element_id": {"type": "integer", "description": "The numeric element ID from the DOM tree (e.g. 3)"}
                },
                "required": ["element_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "Type text into an input/textarea element by its numeric ID from browser_read_page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "element_id": {"type": "integer", "description": "The numeric element ID from the DOM tree"},
                    "text": {"type": "string", "description": "The text to type into the field"}
                },
                "required": ["element_id", "text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_scroll",
            "description": "Scroll the current page up or down. Use this when the user says 'scroll down', 'scroll up', or wants to see more of the page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["up", "down"], "description": "Scroll direction"}
                },
                "required": ["direction"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "Navigate the current browser tab to a specific URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to navigate to"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_screenshot",
            "description": "Take a screenshot of the current browser tab. Returns the image for visual analysis.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    }
]

# In-memory cache for extracted document text: url -> { text, pages }
_extract_cache = {}


def tool_web_search(query):
    """DuckDuckGo search, returns top 5 results."""
    if not query:
        return {"results": []}
    search_url = 'https://html.duckduckgo.com/html/?q=' + urllib.request.quote(query)
    req = urllib.request.Request(search_url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    })
    ctx = get_ssl_context()
    with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
        html = resp.read().decode('utf-8', errors='replace')
    results = []
    title_pattern = re.compile(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL)
    snippet_pattern = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL)
    titles = title_pattern.findall(html)
    snippets = snippet_pattern.findall(html)
    for i, (url, title) in enumerate(titles[:5]):
        clean_title = re.sub(r'<[^>]+>', '', title).strip()
        snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ''
        if 'uddg=' in url:
            actual = re.search(r'uddg=([^&]+)', url)
            if actual:
                url = urllib.request.unquote(actual.group(1))
        results.append({'title': clean_title, 'url': url, 'snippet': snippet})
    return {"results": results}


def tool_search_papers(query):
    """arXiv API search, returns top 5 papers."""
    if not query:
        return {"papers": []}
    arxiv_query = build_arxiv_query(query)
    search_url = (
        f'https://export.arxiv.org/api/query?'
        f'search_query={urllib.request.quote(arxiv_query)}'
        f'&start=0&max_results=5'
        f'&sortBy=relevance&sortOrder=descending'
    )
    req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
    ctx = get_ssl_context()
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        data = resp.read().decode('utf-8', errors='replace')
    papers = []
    entries = re.findall(r'<entry>(.*?)</entry>', data, re.DOTALL)
    for entry in entries[:5]:
        title_m = re.search(r'<title>(.*?)</title>', entry, re.DOTALL)
        summary_m = re.search(r'<summary>(.*?)</summary>', entry, re.DOTALL)
        link_m = re.search(r'<id>(.*?)</id>', entry)
        authors = re.findall(r'<name>(.*?)</name>', entry)
        papers.append({
            'title': re.sub(r'\s+', ' ', title_m.group(1)).strip() if title_m else '',
            'url': link_m.group(1).strip() if link_m else '',
            'authors': authors[:3],
            'summary': re.sub(r'\s+', ' ', summary_m.group(1)).strip()[:300] if summary_m else ''
        })
    return {"papers": papers}


def tool_fetch_page(url):
    """Extract text from a URL."""
    if not url:
        return {"error": "URL required"}
    if url in _extract_cache:
        text = _extract_cache[url].get('text', '')
        return {"text": text[:8000], "truncated": len(text) > 8000}
    is_arxiv = 'arxiv.org' in url
    if is_arxiv:
        pdf_url = url.replace('/abs/', '/pdf/')
        if not pdf_url.endswith('.pdf'):
            pdf_url += '.pdf'
        req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
        ctx = get_ssl_context()
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            pdf_bytes = resp.read()
        import fitz
        tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
        tmp.write(pdf_bytes)
        tmp.close()
        try:
            doc = fitz.open(tmp.name)
            pages = [doc[i].get_text() for i in range(len(doc))]
            doc.close()
        finally:
            os.unlink(tmp.name)
        text = '\n\n---\n\n'.join(pages)
    else:
        from html.parser import HTMLParser
        html_bytes = cached_fetch(url, timeout=30)
        html_str = html_bytes.decode('utf-8', errors='replace')

        class TE(HTMLParser):
            def __init__(self):
                super().__init__()
                self.parts = []
                self._skip = False

            def handle_starttag(self, tag, attrs):
                if tag in ('script', 'style', 'noscript'):
                    self._skip = True

            def handle_endtag(self, tag):
                if tag in ('script', 'style', 'noscript'):
                    self._skip = False

            def handle_data(self, data):
                if not self._skip:
                    t = data.strip()
                    if t:
                        self.parts.append(t)

        ext = TE()
        ext.feed(html_str)
        text = '\n'.join(ext.parts)
    _extract_cache[url] = {'text': text, 'pages': 1}
    return {"text": text[:8000], "truncated": len(text) > 8000}


def tool_create_experiment(title, desc='', google_id=None):
    """Create a new experiment in vault."""
    if not title:
        return {"error": "Title required"}
    if not google_id:
        return {"error": "Not authenticated"}
    from vault_helpers import _get_user_vault_path
    vault = _get_user_vault_path(google_id)
    slug = unique_vault_slug(vault, slugify(title))
    exp_dir = os.path.join(vault, slug)
    os.makedirs(exp_dir, exist_ok=True)
    return {"id": slug, "title": title, "message": f"Project '{title}' created"}


def tool_create_calendar_event(title, date, time='', description='', google_id=None, stream_callback=None):
    """Add an event to the user's calendar."""
    if not title or not date:
        return {"error": "Title and date are required"}
    if not google_id:
        return {"error": "Not authenticated"}
    from users import create_calendar_event
    event_desc = description
    if time:
        event_desc = f"Time: {time}" + (f"\n{description}" if description else "")
    event = create_calendar_event(google_id, {"title": title, "date": date, "description": event_desc})
    if stream_callback:
        stream_callback('action', {"type": "navigate", "view": "calendar"})
    time_str = f" at {time}" if time else ""
    return {"status": "ok", "event": event, "message": f"Event '{title}' added to calendar on {date}{time_str}"}


def execute_chat_tool(name, args, stream_callback=None, google_id=None, context=None):
    """Execute a chat tool and return the result dict.
    stream_callback(event, data) is called for action-type tools (bookmark, navigate).
    context is the page context string (used by browser_read_page to return DOM)."""
    try:
        if name == 'web_search':
            return tool_web_search(args.get('query', ''))
        elif name == 'search_papers':
            return tool_search_papers(args.get('query', ''))
        elif name == 'fetch_page':
            return tool_fetch_page(args.get('url', ''))
        elif name == 'save_to_reading_list':
            if stream_callback:
                stream_callback('action', {"type": "bookmark", "url": args.get("url", ""), "title": args.get("title", "")})
            return {"status": "ok", "message": "Post bookmarked"}
        elif name == 'navigate':
            if stream_callback:
                stream_callback('action', {"type": "navigate", "view": args.get("view", "home")})
            return {"status": "ok", "message": f"Navigated to {args.get('view', 'home')}"}
        elif name == 'open_tab':
            url = args.get("url", "")
            if stream_callback:
                stream_callback('action', {"type": "open_tab", "url": url})
            return {"status": "ok", "message": f"Opened {'a new tab' if not url else url + ' in a new tab'}"}
        elif name == 'create_experiment':
            return tool_create_experiment(args.get('title', ''), args.get('description', ''), google_id=google_id)
        elif name == 'create_calendar_event':
            return tool_create_calendar_event(args.get('title', ''), args.get('date', ''), args.get('time', ''), args.get('description', ''), google_id=google_id, stream_callback=stream_callback)
        elif name == 'browser_read_page':
            if stream_callback:
                stream_callback('action', {"type": "agent_read_page"})
            # Extract DOM section from context if available
            if context and '--- BROWSER TAB DOM' in context:
                import re as _re
                dom_match = _re.search(r'--- BROWSER TAB DOM.*?---\n(.*?)\n--- END DOM ---', context, _re.DOTALL)
                if dom_match:
                    return {"status": "ok", "dom": dom_match.group(1)}
            return {"status": "ok", "message": "DOM is included in your system context. Look for the BROWSER TAB DOM section."}
        elif name == 'browser_click':
            element_id = args.get('element_id')
            if stream_callback:
                stream_callback('action', {"type": "agent_click", "element_id": element_id})
            return {"status": "ok", "message": f"Clicked element {element_id}"}
        elif name == 'browser_type':
            element_id = args.get('element_id')
            text = args.get('text', '')
            if stream_callback:
                stream_callback('action', {"type": "agent_type", "element_id": element_id, "text": text})
            return {"status": "ok", "message": f"Typed into element {element_id}"}
        elif name == 'browser_scroll':
            direction = args.get('direction', 'down')
            if stream_callback:
                stream_callback('action', {"type": "agent_scroll", "direction": direction})
            return {"status": "ok", "message": f"Scrolled {direction}"}
        elif name == 'browser_navigate':
            url = args.get('url', '')
            if stream_callback:
                stream_callback('action', {"type": "agent_navigate", "url": url})
            return {"status": "ok", "message": f"Navigating to {url}"}
        elif name == 'browser_screenshot':
            if stream_callback:
                stream_callback('action', {"type": "agent_screenshot"})
            return {"status": "pending", "message": "Taking screenshot..."}
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}
