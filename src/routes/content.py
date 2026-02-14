"""Content/document routes: doc-chat, extract-text, extract-links, paper-insights,
author-details, citation-lookup, paper-references, author-lookup, citations,
panel-suggest, search-suggest."""
import hashlib
import json
import os
import re
import tempfile
import threading
import time
import urllib.request

from flask import Blueprint, request, jsonify, Response, stream_with_context
from routes.common import get_ssl_context, OLLAMA_HOST

from logger import logger
from helpers import (
    CHAT_TOOLS, execute_chat_tool, sse_event,
    _extract_cache, require_auth,
)
from cache import cached_fetch, smart_highlights_get, smart_highlights_set
from utils_persistence import get_cached_references, set_cached_references, get_cached_author, set_cached_author
from embeddings import (
    store_embedding, embed_text_ollama, search_embeddings,
    pairwise_similarities,
    store_chat_memory, search_chat_memories,
    list_chat_memories, delete_chat_memory, get_memory_stats,
    _unpack_embedding, _cosine_similarity,
)
from annotations import (
    read_annotation_prompt, write_annotation_prompt, annotation_prompt_mtime,
    store_annotation_feedback, list_annotation_feedback,
    update_annotation_feedback_rating, delete_annotation_feedback,
    get_annotation_feedback_stats,
    list_annotation_categories, add_annotation_category, delete_annotation_category,
)

bp = Blueprint('content', __name__)

# ── Module-level caches ──

# In-memory cache for Semantic Scholar API responses to avoid rate limits
# Format: { cache_key: { 'data': ..., 'ts': timestamp } }
_s2_cache = {}
_S2_CACHE_TTL = 3600  # 1 hour

# In-memory cache for paper insights: url -> { repos, contribution }
_insights_cache = {}

# In-memory cache for smart highlights: url -> [items]
_smart_hl_cache = {}

# In-memory cache for page annotations: 'annotate:{url}' -> { data, ts }
_annotate_cache = {}


def _snap_quote_to_text(quote, text, text_lower=None):
    """Find the best matching substring in text for a (possibly imprecise) LLM quote.
    Returns the actual substring from text, or None if no good match found."""
    if not quote or not text:
        return None
    if text_lower is None:
        text_lower = text.lower()
    quote_lower = quote.lower()

    # Exact match — return actual text at that position
    idx = text_lower.find(quote_lower)
    if idx != -1:
        return text[idx:idx + len(quote)]

    # Sliding window fuzzy match: find the substring of similar length
    # with the best character overlap (Jaccard on character bigrams)
    quote_words = quote_lower.split()
    if len(quote_words) < 3:
        return None

    # Try matching with progressively shorter prefixes of the quote
    # (LLMs often start correctly then drift)
    for trim in range(0, min(len(quote_words) // 2, 8)):
        end = len(quote_words) - trim
        partial = ' '.join(quote_words[:end])
        idx = text_lower.find(partial)
        if idx != -1:
            # Found a prefix match — extend to the original quote length
            # by grabbing same char count from the source
            grab_len = min(len(quote) + 20, len(text) - idx)
            candidate = text[idx:idx + grab_len]
            # Trim to word boundary near original quote length
            words = candidate.split()
            target_words = len(quote.split())
            snapped = ' '.join(words[:target_words])
            if len(snapped) >= 15:
                return snapped
            return None

    # Bigram sliding window as last resort
    def bigrams(s):
        return set(s[i:i+2] for i in range(len(s) - 1)) if len(s) > 1 else set()

    q_bigrams = bigrams(quote_lower)
    if not q_bigrams:
        return None

    best_score = 0
    best_start = -1
    window = len(quote)
    step = max(1, window // 4)
    for start in range(0, len(text_lower) - window + 1, step):
        candidate = text_lower[start:start + window]
        c_bigrams = bigrams(candidate)
        intersection = len(q_bigrams & c_bigrams)
        union = len(q_bigrams | c_bigrams)
        score = intersection / union if union else 0
        if score > best_score:
            best_score = score
            best_start = start

    # Refine around best position with step=1
    if best_start >= 0 and best_score > 0.4:
        search_start = max(0, best_start - step)
        search_end = min(len(text_lower) - window + 1, best_start + step + 1)
        for start in range(search_start, search_end):
            candidate = text_lower[start:start + window]
            c_bigrams = bigrams(candidate)
            intersection = len(q_bigrams & c_bigrams)
            union = len(q_bigrams | c_bigrams)
            score = intersection / union if union else 0
            if score > best_score:
                best_score = score
                best_start = start

    if best_score >= 0.55 and best_start >= 0:
        # Snap to word boundaries
        while best_start > 0 and text[best_start - 1] not in ' \t\n':
            best_start -= 1
        end = best_start + window
        while end < len(text) and text[end] not in ' \t\n':
            end += 1
        snapped = text[best_start:end].strip()
        if len(snapped) >= 15:
            return snapped

    return None

SMART_HIGHLIGHTS_PROMPT = (
    "You are a research paper analyzer. Read the document text below and extract "
    "8-15 important passages grouped into three categories:\n"
    "- Claim (3-5): Key claims, hypotheses, or contributions made by the authors\n"
    "- Method (2-4): Methodological approaches, techniques, or algorithms described\n"
    "- Result (3-5): Experimental results, findings, or quantitative outcomes\n\n"
    "For each item provide:\n"
    "- \"category\": one of \"Claim\", \"Method\", or \"Result\"\n"
    "- \"text\": an EXACT verbatim quote from the document (copy-paste, do not paraphrase)\n"
    "- \"summary\": a 1-sentence plain-English paraphrase\n\n"
    "Rules:\n"
    "- Each \"text\" MUST be a direct quote that appears word-for-word in the document\n"
    "- Skip boilerplate (acknowledgments, references, license text, author affiliations)\n"
    "- Keep quotes between 10-80 words each\n"
    "- Respond ONLY with a JSON array, no other text\n\n"
    "--- DOCUMENT TEXT ---\n"
)


# ── Helper: extract text from a URL (shared by extract-text and paper-insights) ──

def _do_extract_text(url):
    """Extract text from a URL (PDF via PyMuPDF for arXiv, HTML text extraction for others).
    Populates _extract_cache and returns the result dict { text, pages }."""
    if url in _extract_cache:
        return _extract_cache[url]

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
            pages = []
            for page_num in range(len(doc)):
                page = doc[page_num]
                page_text = page.get_text()
                pages.append(page_text)
            doc.close()
        finally:
            os.unlink(tmp.name)
        result = {'text': '\n\n---\n\n'.join(pages), 'pages': len(pages)}
    else:
        from html.parser import HTMLParser
        html_bytes = cached_fetch(url, timeout=30)
        html_str = html_bytes.decode('utf-8', errors='replace')

        class TextExtractor(HTMLParser):
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

        extractor = TextExtractor()
        extractor.feed(html_str)
        text = '\n'.join(extractor.parts)
        result = {'text': text, 'pages': 1}

    _extract_cache[url] = result
    return result


# ── Routes ──


@bp.route('/api/doc-chat', methods=['POST'])
def doc_chat():
    body = request.get_json(force=True, silent=True) or {}
    context = body.get('context', '')
    messages = body.get('messages', [])
    is_vision = body.get('vision', False)
    client_model = body.get('model', '')
    tools_enabled = body.get('tools', False)
    think_enabled = body.get('think', True)
    if not messages:
        return jsonify({'error': 'messages required'}), 400

    # Extract google_id for tool calls (best effort)
    from helpers import get_user_from_request
    _chat_google_id = get_user_from_request()

    try:
        from db import log_usage
        log_usage('aether_chat')
    except:
        pass

    if is_vision:
        model = client_model or "qwen3-vl:8b"
        tools_enabled = False  # no tools in vision mode
        system_msg = (
            "You are a helpful visual analysis assistant. The user has taken a screenshot "
            "and wants to ask about it. Describe what you see and answer their questions "
            "based on the visual content provided."
        )
        ollama_messages = [{"role": "system", "content": system_msg}]
        for m in messages:
            msg = {"role": m["role"], "content": m.get("content", "")}
            if m.get("images"):
                msg["images"] = m["images"]
            ollama_messages.append(msg)
    else:
        model = client_model or ("qwen3:8b" if tools_enabled else "qwen2.5:3b")
        truncated_ctx = context[:12000] if context else ''
        # Build page context string for tools
        from datetime import datetime
        now = datetime.now()
        date_str = f'CURRENT DATE AND TIME: {now.strftime("%A, %B %d, %Y, %I:%M %p")} (local time). Always use this date/time for any time-relative requests.\n\n'
        page_ctx = ''
        if tools_enabled:
            page_url = body.get('pageUrl', '')
            page_title = body.get('pageTitle', '')
            if page_url:
                page_ctx = f'\n\nThe user is currently viewing: "{page_title}" ({page_url}). Use this when they refer to "this page", "this paper", etc.'
        if truncated_ctx:
            system_msg = (
                date_str +
                "You are the AI assistant inside Aether, a desktop research app with a built-in "
                "browser, feed reader, calendar, and experiment workspace. The user is reading a "
                "document. Answer their questions based on the document text below when relevant. "
                "You have tools that perform real actions in the app. IMPORTANT: You MUST actually "
                "call the tools to perform actions — never pretend you performed an action or describe "
                "the result without calling the tool first. Never say you "
                "cannot open tabs or navigate — you can, using your tools. "
                "You also have browser automation tools: browser_read_page (see DOM elements with IDs), "
                "browser_click(element_id), browser_type(element_id, text), browser_scroll(direction), "
                "browser_navigate(url). When the user asks you to interact with a web page, use "
                "browser_click/browser_type/browser_scroll to interact. Each element has a numeric ID "
                "like [1], [2] — use these IDs in click/type calls." + page_ctx + "\n\n"
                "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
            ) if tools_enabled else (
                date_str +
                "You are a helpful research assistant. The user is reading a document. "
                "Answer their questions based ONLY on the document text below. "
                "Do not make up information that is not in the document.\n\n"
                "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
            )
        else:
            system_msg = (
                date_str +
                "You are the AI assistant inside Aether, a desktop research app with a built-in "
                "browser, feed reader, calendar, and experiment workspace. You have tools that "
                "perform real actions in the app. IMPORTANT: You MUST actually call the tools to "
                "perform actions — never pretend you performed an action or describe the result "
                "without calling the tool first. Never say you cannot open tabs or "
                "navigate — you can, using your tools. Available tools: web_search, search_papers, "
                "fetch_page, save_to_reading_list, navigate, create_experiment, "
                "create_calendar_event, open_tab. "
                "You also have browser automation tools: browser_read_page (see DOM elements with IDs), "
                "browser_click(element_id), browser_type(element_id, text), browser_scroll(direction), "
                "browser_navigate(url). When the user asks you to interact with a web page, use "
                "browser_click/browser_type/browser_scroll to interact. Each element has a numeric ID "
                "like [1], [2] — use these IDs in click/type calls." + page_ctx
            ) if tools_enabled else (date_str + "You are a helpful assistant.")
        # Inject current date/time into the last user message so the model can't miss it
        if messages:
            messages = [dict(m) for m in messages]  # shallow copy
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get('role') == 'user':
                    time_note = f'[Current date/time: {now.strftime("%Y-%m-%d %H:%M")}]'
                    messages[i]['content'] = time_note + '\n' + messages[i]['content']
                    break
        ollama_messages = [{"role": "system", "content": system_msg}] + messages

    def generate():
        try:
            nonlocal tools_enabled, ollama_messages, model
            # Tool call loop (max 5 iterations)
            if tools_enabled:
                for _ in range(5):
                    tool_payload = {
                        "model": model,
                        "messages": ollama_messages,
                        "tools": CHAT_TOOLS,
                        "stream": False
                    }
                    if not think_enabled:
                        tool_payload["think"] = False
                    payload = json.dumps(tool_payload).encode()
                    req = urllib.request.Request(
                        f"{OLLAMA_HOST}/api/chat",
                        data=payload,
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        result = json.loads(resp.read())
                    msg = result.get("message", {})
                    tool_calls = msg.get("tool_calls")
                    if not tool_calls:
                        # No tool calls -- model produced text, break to stream
                        break
                    # Process each tool call
                    ollama_messages.append(msg)
                    for tc in tool_calls:
                        fn = tc.get("function", {})
                        tool_name = fn.get("name", "")
                        tool_args = fn.get("arguments", {})
                        # Send status event to frontend
                        yield sse_event('tool_call', {"name": tool_name, "args": tool_args})
                        try:
                            from db import log_usage
                            log_usage('tool_call')
                        except:
                            pass
                        # Execute tool; collect action SSE events
                        actions = []

                        def stream_cb(event, data):
                            actions.append((event, data))

                        tool_result = execute_chat_tool(tool_name, tool_args, stream_callback=stream_cb, google_id=_chat_google_id)
                        for ev, d in actions:
                            yield sse_event(ev, d)
                        # Surface web search URLs to frontend for sources pill
                        if tool_name == 'web_search' and isinstance(tool_result, dict) and tool_result.get('results'):
                            yield sse_event('web_sources', tool_result['results'])
                        ollama_messages.append({"role": "tool", "content": json.dumps(tool_result)})
                else:
                    # Exhausted iterations -- do final call without tools
                    pass

            # Final streaming call
            stream_payload = {
                "model": model,
                "messages": ollama_messages,
                "stream": True
            }
            if not think_enabled:
                stream_payload["think"] = False
            payload = json.dumps(stream_payload).encode()
            req = urllib.request.Request(
                f"{OLLAMA_HOST}/api/chat",
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                final_chunk = None
                for line in resp:
                    chunk = json.loads(line)
                    msg = chunk.get("message", {})
                    thinking = msg.get("thinking", "")
                    if thinking:
                        yield sse_event('thinking', thinking)
                    token = msg.get("content", "")
                    if token:
                        yield sse_event('token', token)
                    if chunk.get("done"):
                        final_chunk = chunk
                        break

            # Send usage stats from Ollama's final chunk
            usage = {}
            if final_chunk:
                if "prompt_eval_count" in final_chunk:
                    usage["prompt_tokens"] = final_chunk["prompt_eval_count"]
                if "eval_count" in final_chunk:
                    usage["completion_tokens"] = final_chunk["eval_count"]
                if "total_duration" in final_chunk:
                    usage["duration_ms"] = round(final_chunk["total_duration"] / 1e6)
                if "eval_duration" in final_chunk:
                    usage["eval_ms"] = round(final_chunk["eval_duration"] / 1e6)
                if "model" in final_chunk:
                    usage["model"] = final_chunk["model"]
            if usage:
                yield sse_event('usage', usage)
            yield sse_event('done', {})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            yield sse_event('error', str(e))

    return Response(stream_with_context(generate()),
                    content_type='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive'})


@bp.route('/api/extract-text', methods=['POST'])
def extract_text():
    try:
        # File upload mode (multipart/form-data)
        if 'file' in request.files:
            f = request.files['file']
            name = f.filename or 'file'
            lower = name.lower()
            if lower.endswith('.pdf'):
                import fitz
                pdf_bytes = f.read()
                tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
                tmp.write(pdf_bytes)
                tmp.close()
                try:
                    doc = fitz.open(tmp.name)
                    pages = [doc[i].get_text() for i in range(len(doc))]
                    doc.close()
                finally:
                    os.unlink(tmp.name)
                return jsonify({'text': '\n\n---\n\n'.join(pages), 'pages': len(pages)})
            # Text-like files
            TEXT_EXTS = {'.txt', '.md', '.csv', '.py', '.js', '.ts', '.json', '.html',
                         '.css', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
                         '.sh', '.bash', '.zsh', '.r', '.sql', '.java', '.c', '.cpp',
                         '.h', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.lua'}
            ext = os.path.splitext(lower)[1]
            if ext in TEXT_EXTS:
                text = f.read().decode('utf-8', errors='replace')
                return jsonify({'text': text, 'pages': 1})
            return jsonify({'text': '', 'pages': 0})

        # URL mode (JSON body)
        body = request.get_json(force=True, silent=True) or {}
        url = body.get('url', '').strip()
        if not url:
            return jsonify({'error': 'url required'}), 400
        result = _do_extract_text(url)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/extract-links', methods=['POST'])
def extract_links():
    try:
        body = request.get_json(force=True, silent=True) or {}
        url = body.get('url', '').strip()
        if not url:
            return jsonify({'error': 'url required'}), 400
        from html.parser import HTMLParser
        import urllib.parse as urlparse
        html_bytes = cached_fetch(url, timeout=30)
        html_str = html_bytes.decode('utf-8', errors='replace')

        class LinkExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.links = []
                self._current_tag = None
                self._current_href = None
                self._current_text = ''

            def handle_starttag(self, tag, attrs):
                if tag == 'a':
                    self._current_tag = 'a'
                    self._current_text = ''
                    href = dict(attrs).get('href', '')
                    if href:
                        self._current_href = urlparse.urljoin(url, href)
                    else:
                        self._current_href = None

            def handle_endtag(self, tag):
                if tag == 'a' and self._current_href:
                    text = self._current_text.strip()
                    if text and self._current_href.startswith('http'):
                        self.links.append({'text': text, 'url': self._current_href})
                    self._current_tag = None
                    self._current_href = None
                    self._current_text = ''

            def handle_data(self, data):
                if self._current_tag == 'a':
                    self._current_text += data

        extractor = LinkExtractor()
        extractor.feed(html_str)
        # Deduplicate by URL
        seen = set()
        unique = []
        for link in extractor.links:
            if link['url'] not in seen:
                seen.add(link['url'])
                unique.append(link)
        return jsonify({'links': unique})
    except Exception as e:
        return jsonify({'error': str(e)}), 502


def _extract_smart_highlights(body):
    """Extract structured Claims/Methods/Results highlights from a paper."""
    url = body.get('url', '').strip()
    if not url:
        return jsonify({'error': 'url required'}), 400

    # Check in-memory cache
    if url in _smart_hl_cache:
        return jsonify({'highlights': _smart_hl_cache[url]})

    # Check SQLite cache
    cached = smart_highlights_get(url)
    if cached is not None:
        _smart_hl_cache[url] = cached
        return jsonify({'highlights': cached})

    # Extract text
    extracted = _do_extract_text(url)
    text = extracted['text']
    truncated_text = text[:15000]

    highlights = []
    model = body.get('model') or "qwen2.5:3b"
    logger.info(f"[smart-highlights] Extracting from {url[:80]} using model={model}, text_len={len(truncated_text)}")
    try:
        prompt = SMART_HIGHLIGHTS_PROMPT + truncated_text + "\n--- END ---"
        llm_payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"temperature": 0, "num_predict": 3000}
        }).encode()
        llm_req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/chat",
            data=llm_payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(llm_req, timeout=90) as llm_resp:
            llm_data = json.loads(llm_resp.read())
        raw_content = llm_data.get("message", {}).get("content", "").strip()
        # Parse JSON from response (handle markdown code fences)
        json_str = raw_content
        if '```' in json_str:
            json_str = re.sub(r'```(?:json)?\s*', '', json_str)
            json_str = json_str.replace('```', '')
        json_str = json_str.strip()
        parsed = json.loads(json_str)
        valid_cats = {'Claim', 'Method', 'Result'}
        if isinstance(parsed, list):
            for item in parsed[:15]:
                if isinstance(item, dict) and item.get('category') in valid_cats and item.get('text'):
                    highlights.append({
                        'category': item['category'],
                        'text': item['text'][:500],
                        'summary': (item.get('summary') or '')[:300],
                    })
        logger.info(f"[smart-highlights] Extracted {len(highlights)} highlights")
    except Exception as e:
        logger.error(f"[smart-highlights] LLM extraction failed: {e}")

    # Only cache non-empty results
    if highlights:
        _smart_hl_cache[url] = highlights
        smart_highlights_set(url, highlights)
    return jsonify({'highlights': highlights})


@bp.route('/api/author-details', methods=['POST'])
def author_details():
    try:
        body = request.get_json(force=True, silent=True) or {}
        author_id = body.get('authorId', '').strip()
        if not author_id:
            return jsonify({'error': 'authorId required'}), 400
        # Fetch author details from Semantic Scholar
        s2_url = f'https://api.semanticscholar.org/graph/v1/author/{author_id}?fields=name,affiliations,homepage,hIndex,citationCount,paperCount,url'
        s2_req = urllib.request.Request(s2_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(s2_req, timeout=15) as s2_resp:
            author_data = json.loads(s2_resp.read())
        # Fetch author's top papers
        papers_url = f'https://api.semanticscholar.org/graph/v1/author/{author_id}/papers?fields=title,year,citationCount,url,venue&limit=10'
        papers_req = urllib.request.Request(papers_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(papers_req, timeout=15) as papers_resp:
            papers_data = json.loads(papers_resp.read())
        # Sort papers by citation count
        papers = papers_data.get('data', [])
        papers.sort(key=lambda p: p.get('citationCount', 0) or 0, reverse=True)
        result = {
            'name': author_data.get('name', ''),
            'affiliations': author_data.get('affiliations', []),
            'homepage': author_data.get('homepage'),
            'hIndex': author_data.get('hIndex'),
            'citationCount': author_data.get('citationCount'),
            'paperCount': author_data.get('paperCount'),
            'url': author_data.get('url'),
            'papers': papers[:10]
        }
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/citation-lookup', methods=['POST'])
def citation_lookup():
    # Look up a paper by title on Semantic Scholar
    try:
        body = request.get_json(force=True, silent=True) or {}
        query = body.get('query', '').strip()
        if not query:
            return jsonify({'error': 'query required'}), 400
        # Search Semantic Scholar
        search_url = f'https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.request.quote(query)}&limit=1&fields=title,authors,year,abstract,citationCount,url,venue,externalIds'
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        ctx = get_ssl_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            data = json.loads(resp.read())
        papers = data.get('data', [])
        if not papers:
            return jsonify({'error': 'not found'}), 404
        paper = papers[0]
        result = {
            'title': paper.get('title', ''),
            'authors': [a.get('name', '') for a in paper.get('authors', [])[:5]],
            'year': paper.get('year'),
            'abstract': paper.get('abstract', '')[:500] if paper.get('abstract') else None,
            'citationCount': paper.get('citationCount'),
            'venue': paper.get('venue'),
            'url': paper.get('url'),
            'arxivId': paper.get('externalIds', {}).get('ArXiv'),
        }
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/paper-references', methods=['POST'])
def paper_references():
    # Get references for a paper by arXiv ID
    try:
        body = request.get_json(force=True, silent=True) or {}
        arxiv_id = body.get('arxivId', '').strip()
        ref_num = body.get('refNum')  # Optional -- if provided, return single ref
        if not arxiv_id:
            return jsonify({'error': 'arxivId required'}), 400

        # Check persistent SQLite cache first (references don't change)
        references = get_cached_references(arxiv_id)
        if references is None:
            # Fetch paper references from Semantic Scholar
            api_url = f'https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}?fields=references.title,references.authors,references.year,references.abstract,references.citationCount,references.url,references.venue,references.externalIds'
            req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            ctx = get_ssl_context()
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                data = json.loads(resp.read())
            references = data.get('references', [])
            # Persist to SQLite (permanent -- references don't change)
            set_cached_references(arxiv_id, references)
        if not references:
            return jsonify({'error': 'no references found'}), 404

        # If ref_num provided, return single reference
        if ref_num is not None and ref_num >= 1:
            ref_index = ref_num - 1
            if ref_index < 0 or ref_index >= len(references):
                return jsonify({'error': f'reference {ref_num} not found (paper has {len(references)} references)'}), 404

            ref = references[ref_index]
            if not ref:
                return jsonify({'error': f'reference {ref_num} has no data'}), 404

            result = {
                'title': ref.get('title', ''),
                'authors': [a.get('name', '') for a in ref.get('authors', [])[:5]] if ref.get('authors') else [],
                'year': ref.get('year'),
                'abstract': ref.get('abstract', '')[:500] if ref.get('abstract') else None,
                'citationCount': ref.get('citationCount'),
                'venue': ref.get('venue'),
                'url': ref.get('url'),
                'arxivId': ref.get('externalIds', {}).get('ArXiv') if ref.get('externalIds') else None,
            }
            return jsonify(result)

        # Return all references (compact format for listing)
        result = []
        for i, ref in enumerate(references):
            if ref:
                result.append({
                    'num': i + 1,
                    'title': ref.get('title', ''),
                    'authors': [a.get('name', '') for a in ref.get('authors', [])[:3]] if ref.get('authors') else [],
                    'year': ref.get('year'),
                    'citationCount': ref.get('citationCount'),
                })
        return jsonify({'references': result, 'total': len(references)})
    except urllib.error.HTTPError as e:
        return jsonify({'error': f'Semantic Scholar API error: {e.code}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/author-lookup', methods=['POST'])
def author_lookup():
    # Look up an author on Semantic Scholar (cached in SQLite, stats refreshed daily)
    try:
        body = request.get_json(force=True, silent=True) or {}
        query = body.get('query', '').strip()
        if not query:
            return jsonify({'error': 'query required'}), 400

        cached, needs_refresh = get_cached_author(query)

        if cached and not needs_refresh:
            # Fresh cache hit -- return immediately
            return jsonify(cached)

        # Try to fetch from API (fresh fetch or stale refresh)
        try:
            search_url = f'https://api.semanticscholar.org/graph/v1/author/search?query={urllib.request.quote(query)}&limit=1&fields=name,affiliations,paperCount,citationCount,hIndex,url'
            req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
            ctx = get_ssl_context()
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                data = json.loads(resp.read())
            authors = data.get('data', [])
            if not authors:
                if cached:
                    # API returned nothing but we have stale data -- use it
                    return jsonify(cached)
                return jsonify({'error': 'not found'}), 404
            author = authors[0]
            # Fetch top papers
            author_id = author.get('authorId')
            top_papers = []
            if author_id:
                try:
                    papers_url = f'https://api.semanticscholar.org/graph/v1/author/{author_id}/papers?fields=title,year,citationCount&limit=3&sort=citationCount:desc'
                    req2 = urllib.request.Request(papers_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req2, timeout=10, context=ctx) as resp2:
                        papers_data = json.loads(resp2.read())
                    top_papers = [{'title': p.get('title', ''), 'year': p.get('year'), 'citationCount': p.get('citationCount', 0)} for p in papers_data.get('data', [])[:3]]
                except Exception:
                    # If paper fetch fails, keep top papers from cache if available
                    if cached and cached.get('topPapers'):
                        top_papers = cached['topPapers']
            result = {
                'authorId': author.get('authorId'),
                'name': author.get('name', ''),
                'affiliations': author.get('affiliations', []),
                'paperCount': author.get('paperCount'),
                'citationCount': author.get('citationCount'),
                'hIndex': author.get('hIndex'),
                'url': author.get('url'),
                'topPapers': top_papers,
            }
            # Persist to SQLite
            set_cached_author(query, result)
            return jsonify(result)
        except Exception:
            if cached:
                # API failed but we have stale data -- serve it
                return jsonify(cached)
            else:
                raise
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/citations', methods=['POST'])
def batch_citations():
    try:
        body = request.get_json(force=True, silent=True) or {}
        arxiv_ids = body.get('ids', [])
        if not arxiv_ids:
            return jsonify({'error': 'ids required'}), 400
        paper_ids = [f'ArXiv:{aid}' for aid in arxiv_ids]
        payload = json.dumps({'ids': paper_ids}).encode()
        req = urllib.request.Request(
            'https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,externalIds',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            method='POST'
        )
        ctx = get_ssl_context()
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            data = json.loads(resp.read())
        result = {}
        for item in data:
            if item and item.get('externalIds', {}).get('ArXiv'):
                aid = item['externalIds']['ArXiv']
                result[aid] = item.get('citationCount', 0)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/panel-suggest', methods=['POST'])
def panel_suggest():
    try:
        body = request.get_json(force=True, silent=True) or {}
        text = body.get('text', '').strip()
        if not text or len(text) < 3:
            return jsonify({'suggestion': ''})
        snippet = text[:300]
        payload = json.dumps({
            "model": "qwen3:0.6b",
            "messages": [
                {"role": "system", "content": "Given some text the user selected or is looking at, suggest ONE short question (under 12 words) they might want to ask about it. Return ONLY the question, nothing else. No quotes."},
                {"role": "user", "content": snippet}
            ],
            "stream": False,
            "think": False,
            "options": {"temperature": 0.7, "num_predict": 40}
        }).encode()
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp_data = json.loads(resp.read())
        raw = resp_data.get("message", {}).get("content", "").strip().strip('"\'')
        # Take first line only
        suggestion = raw.split('\n')[0].strip()
        if len(suggestion) > 80:
            suggestion = suggestion[:77] + '\u2026'
        return jsonify({'suggestion': suggestion})
    except Exception:
        return jsonify({'suggestion': ''})


@bp.route('/api/search-suggest', methods=['POST'])
def search_suggest():
    try:
        body = request.get_json(force=True, silent=True) or {}
        query = body.get('query', '').strip()
        if not query or len(query) < 2:
            return jsonify({'suggestions': []})
        payload = json.dumps({
            "model": "qwen3:0.6b",
            "messages": [
                {"role": "system", "content": "You are a search autocomplete engine. Given a partial search query, suggest 4 completions. Return ONLY a JSON array of strings, nothing else. Example: [\"machine learning basics\", \"machine learning tutorial\"]"},
                {"role": "user", "content": query}
            ],
            "stream": False,
            "think": False,
            "options": {"temperature": 0.7, "num_predict": 120}
        }).encode()
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_data = json.loads(resp.read())
        raw = resp_data.get("message", {}).get("content", "").strip()
        # Parse the JSON array from the response
        arr_match = re.search(r'\[.*\]', raw, re.DOTALL)
        if arr_match:
            suggestions = json.loads(arr_match.group())
            suggestions = [s for s in suggestions if isinstance(s, str) and s.strip()][:4]
        else:
            suggestions = []
        return jsonify({'suggestions': suggestions})
    except Exception:
        return jsonify({'suggestions': []})


# ── Semantic embeddings ──

_embed_model_cache = {'available': None, 'ts': 0}

def _check_embed_model():
    now = time.time()
    if now - _embed_model_cache['ts'] < 300 and _embed_model_cache['available'] is not None:
        return _embed_model_cache['available']
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        models = data.get('models', [])
        found = any('nomic-embed-text' in m.get('name', '') for m in models)
        _embed_model_cache['available'] = found
        _embed_model_cache['ts'] = now
        return found
    except Exception:
        _embed_model_cache['available'] = False
        _embed_model_cache['ts'] = now
        return False


@bp.route('/api/embed-content', methods=['POST'])
def embed_content():
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    link = body.get('link', '').strip()
    if not title or not link:
        return jsonify({'ok': True})
    source = body.get('source', '')
    description = body.get('description', '')
    content_type = body.get('type', 'post')
    text = f"{title}. {description[:500]}" if description else title
    def _do_embed():
        try:
            store_embedding(text, title, link, source, content_type)
        except Exception:
            pass
    t = threading.Thread(target=_do_embed, daemon=True)
    t.start()
    return jsonify({'ok': True})


@bp.route('/api/semantic-search', methods=['POST'])
def semantic_search():
    body = request.get_json(force=True, silent=True) or {}
    query = body.get('query', '').strip()
    if not query:
        return jsonify({'error': 'query required'}), 400
    if not _check_embed_model():
        return jsonify({'error': 'nomic-embed-text model not available'}), 503
    query_vec = embed_text_ollama(query)
    if not query_vec:
        return jsonify({'error': 'embedding failed'}), 502
    content_type = body.get('type')
    limit = min(body.get('limit', 20), 50)
    results = search_embeddings(query_vec, content_type=content_type, limit=limit)
    return jsonify({'results': results})


@bp.route('/api/find-similar', methods=['POST'])
def find_similar():
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    link = body.get('link', '').strip()
    description = body.get('description', '')
    if not title:
        return jsonify({'error': 'title required'}), 400
    if not _check_embed_model():
        return jsonify({'error': 'nomic-embed-text model not available'}), 503
    text = f"{title}. {description[:500]}" if description else title
    query_vec = embed_text_ollama(text)
    if not query_vec:
        return jsonify({'error': 'embedding failed'}), 502
    limit = min(body.get('limit', 20), 50)
    results = search_embeddings(query_vec, limit=limit, exclude_link=link)
    return jsonify({'results': results})


@bp.route('/api/chat-memory', methods=['POST'])
@require_auth
def save_chat_memory(google_id=None):
    """Save a chat conversation summary for future recall. Fire-and-forget."""
    body = request.get_json(force=True, silent=True) or {}
    messages = body.get('messages', [])
    page_url = body.get('pageUrl', '')
    page_title = body.get('pageTitle', '')
    if len(messages) < 2:
        return jsonify({'ok': True})

    def _summarize_and_store():
        try:
            conversation = '\n'.join(
                f"{m['role'].upper()}: {m.get('content', '')}" for m in messages[:20]
            )
            prompt = (
                "Summarize this conversation in 2-3 sentences. Focus on the key topics discussed "
                "and any conclusions or insights reached. Then list the main topics as comma-separated keywords.\n\n"
                "Format:\nSUMMARY: <summary>\nTOPICS: <topic1, topic2, ...>\n\n"
                + conversation[:4000]
            )
            payload = json.dumps({
                "model": "qwen2.5:1.5b",
                "messages": [{"role": "user", "content": prompt}],
                "stream": False
            }).encode()
            req = urllib.request.Request(
                f"{OLLAMA_HOST}/api/chat",
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            reply = data.get('message', {}).get('content', '')
            summary = reply
            topics = ''
            if 'SUMMARY:' in reply:
                parts = reply.split('TOPICS:')
                summary = parts[0].replace('SUMMARY:', '').strip()
                if len(parts) > 1:
                    topics = parts[1].strip()
            store_chat_memory(summary, topics, page_url, page_title, len(messages))
        except Exception:
            pass

    threading.Thread(target=_summarize_and_store, daemon=True).start()
    return jsonify({'ok': True})


@bp.route('/api/chat-memories', methods=['GET'])
@require_auth
def get_chat_memories(google_id=None):
    """Search past chat memories by semantic similarity."""
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({'memories': []})
    if not _check_embed_model():
        return jsonify({'memories': []})
    query_vec = embed_text_ollama(query)
    if not query_vec:
        return jsonify({'memories': []})
    results = search_chat_memories(query_vec, limit=3)
    filtered = [r for r in results if r['score'] > 0.5]
    return jsonify({'memories': filtered})


@bp.route('/api/chat-memories/list', methods=['GET'])
@require_auth
def list_memories(google_id=None):
    """List all chat memories with pagination."""
    limit = int(request.args.get('limit', 50))
    offset = int(request.args.get('offset', 0))
    result = list_chat_memories(limit=limit, offset=offset)
    return jsonify(result)


@bp.route('/api/chat-memories/<int:memory_id>', methods=['DELETE'])
@require_auth
def remove_memory(memory_id, google_id=None):
    """Delete a single chat memory."""
    delete_chat_memory(memory_id)
    return jsonify({'ok': True})


@bp.route('/api/chat-memories/stats', methods=['GET'])
@require_auth
def memory_stats(google_id=None):
    """Get memory stats: count, date range, top topics."""
    return jsonify(get_memory_stats())


@bp.route('/api/reading-connections', methods=['POST'])
def reading_connections():
    """Find connections between current paper and previously read papers."""
    body = request.get_json(force=True, silent=True) or {}
    title = body.get('title', '').strip()
    description = body.get('description', '')
    read_links = body.get('readLinks', [])
    if not title or not read_links:
        return jsonify({'results': []})
    if not _check_embed_model():
        return jsonify({'results': []})
    text = f"{title}. {description[:500]}" if description else title
    query_vec = embed_text_ollama(text)
    if not query_vec:
        return jsonify({'results': []})
    from db import _get_db
    conn = _get_db()
    placeholders = ','.join('?' * len(read_links[:200]))
    rows = conn.execute(
        f"SELECT title, link, source, embedding, dim FROM embeddings WHERE link IN ({placeholders})",
        read_links[:200]
    ).fetchall()
    conn.close()
    results = []
    for row in rows:
        vec = _unpack_embedding(row['embedding'], row['dim'])
        score = _cosine_similarity(query_vec, vec)
        if score > 0.4:
            results.append({
                'title': row['title'],
                'link': row['link'],
                'source': row['source'],
                'score': round(score, 4)
            })
    results.sort(key=lambda x: x['score'], reverse=True)
    return jsonify({'results': results[:10]})


@bp.route('/api/annotate', methods=['POST'])
def annotate_page():
    """Annotate page text with key findings, contradictions, and claims to verify."""
    try:
        body = request.get_json(force=True, silent=True) or {}
        text = (body.get('text') or '').strip()
        url = (body.get('url') or '').strip()
        other_tabs = body.get('otherTabs') or []
        interest_context = (body.get('interest_context') or '').strip()
        if not text:
            return jsonify({'error': 'text required'}), 400

        # Check in-memory cache (5 min TTL)
        now = time.time()
        interest_hash = hashlib.sha256(interest_context.encode()).hexdigest()[:8] if interest_context else ''
        cache_key = f'annotate:{url}:{interest_hash}' if url else None
        if cache_key and cache_key in _annotate_cache:
            entry = _annotate_cache[cache_key]
            if now - entry['ts'] < 300:
                return jsonify({'annotations': entry['data']})

        # Truncate inputs
        main_text = text[:12000]
        tab_context = ''
        for tab in other_tabs[:3]:
            t_title = (tab.get('title') or '')[:100]
            t_text = (tab.get('text') or '')[:3000]
            if t_text:
                tab_context += f'\n\n--- OTHER TAB: "{t_title}" ---\n{t_text}\n--- END TAB ---'

        # Build prompt from stored/default + feedback examples + custom categories
        custom_prompt = read_annotation_prompt()
        prompt = (custom_prompt or DEFAULT_ANNOTATION_PROMPT)

        # Append custom annotation categories
        custom_cats = list_annotation_categories()
        if custom_cats:
            prompt += "Additional annotation types:\n"
            for cat in custom_cats:
                prompt += f"- {cat['key']} — {cat['description']}\n"
            prompt += "\n"

        # Append feedback examples as few-shot context
        good_examples = list_annotation_feedback(rating='good', limit=10)
        bad_examples = list_annotation_feedback(rating='bad', limit=10)
        if good_examples:
            prompt += "EXAMPLES OF GOOD ANNOTATIONS (produce more like these):\n"
            for ex in good_examples:
                prompt += f"- \"{ex['quote'][:200]}\"" + (f" [{ex['ann_type']}]" if ex['ann_type'] else "") + "\n"
            prompt += "\n"
        if bad_examples:
            prompt += "EXAMPLES OF BAD ANNOTATIONS (avoid these):\n"
            for ex in bad_examples:
                prompt += f"- \"{ex['quote'][:200]}\"" + (f" [{ex['ann_type']}]" if ex['ann_type'] else "") + "\n"
            prompt += "\n"
        if interest_context:
            prompt += "USER INTERESTS:\n" + interest_context + "\n\n"
        prompt += "--- MAIN PAGE TEXT ---\n" + main_text + "\n--- END PAGE TEXT ---"
        if tab_context:
            prompt += tab_context

        model = body.get('model') or 'qwen2.5:3b'
        logger.info(f"[annotate] url={url[:80]} model={model} text_len={len(main_text)} tabs={len(other_tabs[:3])}")
        llm_payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "think": False,
            "options": {"temperature": 0, "num_predict": 6000}
        }).encode()
        llm_req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/chat",
            data=llm_payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(llm_req, timeout=120) as llm_resp:
            llm_data = json.loads(llm_resp.read())
        raw_content = llm_data.get("message", {}).get("content", "").strip()

        # Parse JSON from response — strip thinking tags, code fences
        json_str = raw_content
        json_str = re.sub(r'<think>.*?</think>', '', json_str, flags=re.DOTALL)
        if '```' in json_str:
            json_str = re.sub(r'```(?:json)?\s*', '', json_str)
            json_str = json_str.replace('```', '')
        json_str = json_str.strip()
        # Extract first JSON array if there's surrounding text
        arr_match = re.search(r'\[.*\]', json_str, re.DOTALL)
        if arr_match:
            json_str = arr_match.group()
        parsed = json.loads(json_str)

        valid_types = {'ALPHA', 'CONTRADICTION', 'AD'}
        for cat in custom_cats:
            valid_types.add(cat['key'])
        text_lower = text.lower()
        annotations = []
        if isinstance(parsed, list):
            for item in parsed[:15]:
                if not isinstance(item, dict):
                    continue
                atype = item.get('type', '')
                quote = (item.get('quote') or '').strip()
                explanation = (item.get('explanation') or '').strip()
                if atype not in valid_types or not quote:
                    continue
                # Snap quote to actual source text via fuzzy matching
                snapped = _snap_quote_to_text(quote, text, text_lower)
                if not snapped:
                    continue
                # Parse and clamp confidence
                confidence = 70
                try:
                    conf_val = int(item.get('confidence', 70))
                    confidence = max(0, min(100, conf_val))
                except (ValueError, TypeError):
                    pass
                ann = {'type': atype, 'quote': snapped[:500], 'explanation': explanation[:300], 'confidence': confidence}
                if atype == 'CONTRADICTION' and item.get('conflictsWith'):
                    ann['conflictsWith'] = item['conflictsWith'][:200]
                annotations.append(ann)

        # Cross-reference search: find related saved posts and memories
        try:
            snippet = text[:1500]
            xref_vec = embed_text_ollama(snippet)
            if xref_vec:
                connections = []
                # Search saved posts
                saved_results = search_embeddings(xref_vec, content_type='post', limit=3, exclude_link=url)
                for r in saved_results:
                    if r['score'] > 0.75 and len(connections) < 2:
                        connections.append({
                            'type': 'CONNECTION',
                            'explanation': f"Related to saved post (similarity {int(r['score']*100)}%)",
                            'confidence': int(r['score'] * 100),
                            'linkedTitle': (r.get('title') or '')[:120],
                            'linkedUrl': r.get('link') or ''
                        })
                # Search chat memories
                mem_results = search_chat_memories(xref_vec, limit=2)
                for r in mem_results:
                    if r['score'] > 0.75 and len(connections) < 2:
                        connections.append({
                            'type': 'CONNECTION',
                            'explanation': f"Related conversation: {(r.get('topics') or '')[:80]}",
                            'confidence': int(r['score'] * 100),
                            'linkedTitle': (r.get('page_title') or r.get('summary', '')[:60]),
                            'linkedUrl': r.get('page_url') or ''
                        })
                annotations.extend(connections)
        except Exception as xref_err:
            logger.warn(f"[annotate] Cross-reference search failed: {xref_err}")

        # Cache result
        if cache_key:
            _annotate_cache[cache_key] = {'data': annotations, 'ts': now}

        return jsonify({'annotations': annotations})
    except Exception as e:
        return jsonify({'error': str(e)}), 502


# ── Annotation Feedback ──

@bp.route('/api/annotation-feedback', methods=['POST'])
@require_auth
def create_annotation_feedback(google_id=None):
    body = request.get_json(force=True, silent=True) or {}
    quote = (body.get('quote') or '').strip()
    rating = str(body.get('rating') or '').strip()
    if not quote or rating not in ('good', 'bad'):
        return jsonify({'error': 'quote and rating (good/bad) required'}), 400
    store_annotation_feedback(
        body.get('url', ''), body.get('pageTitle', ''),
        quote, body.get('explanation', ''),
        body.get('annType', ''), rating
    )
    return jsonify({'ok': True})


@bp.route('/api/annotation-feedback', methods=['GET'])
@require_auth
def get_annotation_feedback(google_id=None):
    rating = request.args.get('rating')
    limit = min(int(request.args.get('limit', 100)), 500)
    offset = int(request.args.get('offset', 0))
    items = list_annotation_feedback(rating=rating, limit=limit, offset=offset)
    return jsonify({'items': items})


@bp.route('/api/annotation-feedback/stats', methods=['GET'])
@require_auth
def get_feedback_stats(google_id=None):
    return jsonify(get_annotation_feedback_stats())


@bp.route('/api/annotation-feedback/<int:fid>', methods=['PUT'])
@require_auth
def update_feedback(fid, google_id=None):
    body = request.get_json(force=True, silent=True) or {}
    rating = str(body.get('rating') or '').strip()
    if rating not in ('good', 'bad'):
        return jsonify({'error': 'rating must be good or bad'}), 400
    update_annotation_feedback_rating(fid, rating)
    return jsonify({'ok': True})


@bp.route('/api/annotation-feedback/<int:fid>', methods=['DELETE'])
@require_auth
def delete_feedback(fid, google_id=None):
    delete_annotation_feedback(fid)
    return jsonify({'ok': True})


# ── Annotation Prompt ──

DEFAULT_ANNOTATION_PROMPT = (
    "You are a helpful assistant whose job it is twofold. First, you must point out AI slop and also point out redundant information to protect the user from potentially harmful, fearmongering, or biased sentences. At the same time, you are also in charge of highlighting IMPORTANT sentences and key ideas of the current article, book, paper, or general website page that the user is visiting. Read the page and return ONLY extremely high-signal annotations. Zero fluff. Do not point out anything that is obvious.\n\n"
    "Annotation types:\n"
    "- ALPHA — Something lowkey, an uncommon or surprising result or fact. The thing worth remembering. Only use for genuinely informative information.\n"
    "- CONTRADICTION — a sentence idea, or thought that shows a logical flaw. one that conflicts with previous sentences. You MUST explain the specific contradiction and why the two claims can't both be true.\n"
    "- AD — sponsored content, affiliate links, product placement, or advertorial disguised as editorial. Flag anything that looks like it's trying to sell you something while pretending to be informational. Do not flag pip installs.\n\n"
    "For each annotation provide a JSON object with:\n"
    "- \"type\": one of the types above\n"
    "- \"quote\": a passage copied EXACTLY from the page text (10-40 words). Do NOT paraphrase.\n"
    "- \"explanation\": 1-2 sentences. For ALPHA: why this matters. For CONTRADICTION: what it contradicts and why. For AD: what's being sold.\n"
    "- \"confidence\": 0-100 how confident you are\n"
    "- \"conflictsWith\": (only for CONTRADICTION) the sentence of the conflicting claim\n\n"
    "Rules:\n"
    "- CRITICAL: Every quote must be a VERBATIM substring of the page text. Do not change ANY words. It must be verbatim from the text.\n"
    "- Only use CONTRADICTION if there is a real logical flaw.\n"
    "- Always use AD if the sentence seems to be trying to sell a product or service.\n"
    "- Return 1-3 annotations for a typical page. 5-8 for longer textbooks and articles.\n"
    "- If the page has no key results and no ads, return an empty array [].\n"
    "- Respond ONLY with a JSON array, no other text\n\n"
)


@bp.route('/api/annotation-prompt', methods=['GET'])
def get_annotation_prompt():
    custom = read_annotation_prompt()
    mtime = annotation_prompt_mtime()
    return jsonify({
        'prompt': custom or DEFAULT_ANNOTATION_PROMPT,
        'default': DEFAULT_ANNOTATION_PROMPT,
        'isCustom': custom is not None,
        'updatedAt': mtime
    })


@bp.route('/api/annotation-prompt', methods=['PUT'])
def set_annotation_prompt():
    body = request.get_json(force=True, silent=True) or {}
    prompt = (body.get('prompt') or '').strip()
    write_annotation_prompt(prompt if prompt else None)
    return jsonify({'ok': True})


# ── Annotation Categories ──

@bp.route('/api/annotation-categories', methods=['GET'])
@require_auth
def get_annotation_categories(google_id=None):
    return jsonify({'categories': list_annotation_categories()})


@bp.route('/api/annotation-categories', methods=['POST'])
@require_auth
def create_annotation_category(google_id=None):
    body = request.get_json(force=True, silent=True) or {}
    key = (body.get('key') or '').strip().upper()
    name = (body.get('name') or '').strip()
    desc = (body.get('description') or '').strip()
    color = (body.get('color') or '#888888').strip()
    if not key or not name or not desc:
        return jsonify({'error': 'key, name, and description required'}), 400
    add_annotation_category(key, name, desc, color)
    return jsonify({'ok': True})


@bp.route('/api/annotation-categories/<key>', methods=['DELETE'])
@require_auth
def remove_annotation_category(key, google_id=None):
    delete_annotation_category(key)
    return jsonify({'ok': True})


@bp.route('/api/knowledge-graph/similarities', methods=['POST'])
def knowledge_graph_similarities():
    body = request.get_json(force=True, silent=True) or {}
    links = body.get('links', [])
    if not links or not isinstance(links, list):
        return jsonify({'edges': []})
    threshold = float(body.get('threshold', 0.65))
    edges = pairwise_similarities(links, threshold=threshold)
    return jsonify({'edges': edges})
