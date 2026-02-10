"""Content/document routes: doc-chat, extract-text, extract-links, paper-insights,
author-details, citation-lookup, paper-references, author-lookup, citations,
panel-suggest, search-suggest."""
import concurrent.futures
import json
import os
import re
import ssl
import tempfile
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET

from flask import Blueprint, request, jsonify, Response, stream_with_context

from helpers import (
    build_arxiv_query, CHAT_TOOLS, execute_chat_tool, sse_event,
    _extract_cache,
)
from persistence import (
    cached_fetch, get_cached_references, set_cached_references,
    get_cached_author, set_cached_author,
    store_embedding, embed_text_ollama, search_embeddings,
    pairwise_similarities,
    smart_highlights_get, smart_highlights_set,
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
        ctx = ssl._create_unverified_context()
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
        from persistence import log_usage
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
                "cannot open tabs or navigate — you can, using your tools." + page_ctx + "\n\n"
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
                "create_calendar_event, open_tab." + page_ctx
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
                        "http://localhost:11434/api/chat",
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
                            from persistence import log_usage
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
                "http://localhost:11434/api/chat",
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
    print(f"[smart-highlights] Extracting from {url[:80]} using model={model}, text_len={len(truncated_text)}")
    try:
        prompt = SMART_HIGHLIGHTS_PROMPT + truncated_text + "\n--- END ---"
        llm_payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"temperature": 0, "num_predict": 3000}
        }).encode()
        llm_req = urllib.request.Request(
            "http://localhost:11434/api/chat",
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
        print(f"[smart-highlights] Extracted {len(highlights)} highlights")
    except Exception as e:
        print(f"[smart-highlights] LLM extraction failed: {e}")

    # Only cache non-empty results
    if highlights:
        _smart_hl_cache[url] = highlights
        smart_highlights_set(url, highlights)
    return jsonify({'highlights': highlights})


@bp.route('/api/paper-insights', methods=['POST'])
def paper_insights():
    try:
        body = request.get_json(force=True, silent=True) or {}
        url = body.get('url', '').strip()
        if not url:
            return jsonify({'error': 'url required'}), 400

        # Smart highlights mode — separate extraction pipeline
        mode = body.get('mode', 'insights')
        if mode == 'highlights':
            return _extract_smart_highlights(body)

        allow_heuristics = body.get('allowHeuristics', True)
        _cache_key = url + ('::h' if allow_heuristics else '::noh')
        # Cache read disabled for dev -- always fetch fresh

        # Reuse extract-text logic to get document text
        extracted = _do_extract_text(url)
        text = extracted['text']

        # 0. Extract authors from Semantic Scholar (includes stats)
        authors = []
        paper_title = None
        arxiv_match = re.search(r'(\d{4}\.\d{4,5})', url)
        if arxiv_match:
            arxiv_id = arxiv_match.group(1)
            cache_key = f'authors:{arxiv_id}'
            now = time.time()
            # Check cache first
            if cache_key in _s2_cache and (now - _s2_cache[cache_key]['ts']) < _S2_CACHE_TTL:
                authors = _s2_cache[cache_key]['data']
                print(f'[paper-insights] Using cached author data for {arxiv_id}')
            else:
                try:
                    # First get paper with author IDs
                    s2_url = f'https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}?fields=title,authors.authorId,authors.name,authors.affiliations'
                    s2_req = urllib.request.Request(s2_url, headers={'User-Agent': 'Mozilla/5.0'})
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(s2_req, timeout=10, context=ctx) as s2_resp:
                        s2_data = json.loads(s2_resp.read())
                    print(f'[paper-insights] S2 paper authors: {len(s2_data.get("authors", []))} authors')
                    if s2_data.get('title'):
                        paper_title = s2_data['title']
                    if 'authors' in s2_data:
                        # Collect author IDs for batch lookup (limit to first 10)
                        author_ids = []
                        basic_authors = []
                        for a in s2_data['authors'][:10]:
                            author_info = {'name': a.get('name', '')}
                            if a.get('authorId'):
                                author_info['authorId'] = a['authorId']
                                author_ids.append(a['authorId'])
                            if a.get('affiliations'):
                                author_info['affiliation'] = a['affiliations'][0] if isinstance(a['affiliations'], list) else a['affiliations']
                            basic_authors.append(author_info)

                        # Batch fetch author details if we have IDs
                        if author_ids:
                            try:
                                batch_url = 'https://api.semanticscholar.org/graph/v1/author/batch'
                                batch_body = json.dumps({'ids': author_ids}).encode('utf-8')
                                batch_req = urllib.request.Request(
                                    f'{batch_url}?fields=authorId,hIndex,paperCount,citationCount',
                                    data=batch_body,
                                    headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'},
                                    method='POST'
                                )
                                with urllib.request.urlopen(batch_req, timeout=10, context=ctx) as batch_resp:
                                    author_details = json.loads(batch_resp.read())
                                print(f'[paper-insights] S2 author details sample: {author_details[:1] if author_details else "none"}')
                                # Create lookup by authorId
                                details_map = {d['authorId']: d for d in author_details if d and d.get('authorId')}
                                # Merge details into basic_authors
                                for author_info in basic_authors:
                                    aid = author_info.get('authorId')
                                    if aid and aid in details_map:
                                        d = details_map[aid]
                                        if d.get('hIndex'):
                                            author_info['hIndex'] = d['hIndex']
                                        if d.get('paperCount'):
                                            author_info['paperCount'] = d['paperCount']
                                        if d.get('citationCount'):
                                            author_info['citationCount'] = d['citationCount']
                            except Exception as e2:
                                print(f'[paper-insights] S2 author batch fetch failed: {e2}')

                        authors = basic_authors
                        # Cache the result
                        _s2_cache[cache_key] = {'data': authors, 'ts': now}
                except Exception as e:
                    print(f'[paper-insights] Semantic Scholar author fetch failed: {e}')
            # Fallback to arXiv API for just names (only if S2 failed)
            if not authors:
                try:
                    api_url = f'https://export.arxiv.org/api/query?id_list={arxiv_id}'
                    api_req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(api_req, timeout=15, context=ctx) as api_resp:
                        api_xml = api_resp.read().decode('utf-8')
                    root = ET.fromstring(api_xml)
                    ns = {'atom': 'http://www.w3.org/2005/Atom'}
                    for entry in root.findall('atom:entry', ns):
                        for author_el in entry.findall('atom:author', ns):
                            name_el = author_el.find('atom:name', ns)
                            if name_el is not None and name_el.text:
                                authors.append({'name': name_el.text.strip()})
                except Exception:
                    pass

        # 1. Extract repo URLs (heuristic -- regex)
        repos = []
        if allow_heuristics:
            repo_pattern = re.compile(
                r'https?://(?:github\.com|gitlab\.com|huggingface\.co|bitbucket\.org)'
                r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_./-]*)?'
            )
            context_pattern = re.compile(
                r'(?:code|implementation|source|repository|available|released|open[- ]?source)[^.]*?(https?://(?:github\.com|gitlab\.com|huggingface\.co|bitbucket\.org)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)',
                re.IGNORECASE
            )
            raw_urls = repo_pattern.findall(text)
            seen = {}
            for u in raw_urls:
                u = u.rstrip('/')
                u = re.sub(r'[.,;:)\]]+$', '', u)
                parts = u.split('/')
                if len(parts) >= 5:
                    base = '/'.join(parts[:5])
                else:
                    base = u
                if base not in seen:
                    seen[base] = u
                    repos.append({'url': base, 'context': ''})
            context_matches = context_pattern.findall(text)
            for cm in context_matches:
                cm_base = '/'.join(cm.rstrip('/').split('/')[:5])
                for r in repos:
                    if r['url'] == cm_base and not r['context']:
                        r['context'] = 'Code repository'

        # 2. Extract key insights via LLM (Ollama qwen2.5:3b)
        normalized = re.sub(r'(?<![.!?\n])\n(?![A-Z\n])', ' ', text)
        normalized = re.sub(r'  +', ' ', normalized)
        sentences = re.split(r'(?<=[.!?])\s+', normalized)
        truncated_text = text[:10000]
        insights = []
        try:
            insight_prompt = (
                "You are a research paper analyzer. Read the document text below and extract "
                "the most important insights. For each insight, provide a category label and "
                "quote the EXACT sentence or passage from the text (do not paraphrase).\n\n"
                "Categories: Contribution, Result, Method, Surprising, Design\n\n"
                "Respond ONLY with a JSON array. Each element: {\"label\": \"Category\", \"text\": \"exact quote from paper\"}\n"
                "Return 3-5 insights. Only use categories from the list above.\n"
                "If you cannot find insights for a category, skip it.\n\n"
                "--- DOCUMENT TEXT ---\n" + truncated_text + "\n--- END ---"
            )
            llm_payload = json.dumps({
                "model": "qwen2.5:3b",
                "messages": [{"role": "user", "content": insight_prompt}],
                "stream": False,
                "options": {"temperature": 0, "num_predict": 1500}
            }).encode()
            llm_req = urllib.request.Request(
                "http://localhost:11434/api/chat",
                data=llm_payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(llm_req, timeout=60) as llm_resp:
                llm_data = json.loads(llm_resp.read())
            raw_content = llm_data.get("message", {}).get("content", "").strip()
            # Parse JSON from response (handle markdown code fences)
            json_str = raw_content
            if '```' in json_str:
                json_str = re.sub(r'```(?:json)?\s*', '', json_str)
                json_str = json_str.replace('```', '')
            json_str = json_str.strip()
            parsed_insights = json.loads(json_str)
            valid_labels = {'Contribution', 'Result', 'Method', 'Surprising', 'Design'}
            if isinstance(parsed_insights, list):
                for item in parsed_insights[:5]:
                    if isinstance(item, dict) and 'label' in item and 'text' in item:
                        label = item['label']
                        if label in valid_labels:
                            insights.append({'label': label, 'text': item['text'][:300]})
        except Exception as llm_err:
            print(f"[insights] LLM extraction failed: {llm_err}")
            if allow_heuristics:
                print("[insights] Falling back to keyword matching")
                fallback_phrases = {
                    'Contribution': ['we propose', 'we introduce', 'we present', 'this paper presents'],
                    'Result': ['we show that', 'we achieve', 'outperforms', 'state-of-the-art'],
                    'Method': ['our method', 'our approach', 'our framework', 'we train'],
                }
                used_sentences = set()
                for category, phrases in fallback_phrases.items():
                    for s in sentences:
                        s_clean = ' '.join(s.split())
                        if len(s_clean) < 40:
                            continue
                        if any(p in s_clean.lower() for p in phrases) and s_clean not in used_sentences:
                            trimmed = s_clean[:300]
                            if len(s_clean) > 300:
                                trimmed = trimmed.rsplit(' ', 1)[0] + '...'
                            insights.append({'label': category, 'text': trimmed})
                            used_sentences.add(s_clean)
                            break

        # 3. Extract GPU/hardware info (heuristic -- regex)
        if allow_heuristics:
            gpu_pattern = re.compile(
                r'(?:NVIDIA|AMD|Intel)?\s*(?:A100|H100|V100|A6000|A40|RTX\s*\d{4}\s*(?:Ti)?|'
                r'P100|T4|K80|TPU\s*v\d|MI\d{3}|GeForce|Titan|3090|4090|A10G)',
                re.IGNORECASE
            )
            gpu_matches = gpu_pattern.findall(normalized)
            if gpu_matches:
                seen_gpus = set()
                unique_gpus = []
                for g in gpu_matches:
                    g_clean = ' '.join(g.split())
                    if g_clean.lower() not in seen_gpus:
                        seen_gpus.add(g_clean.lower())
                        unique_gpus.append(g_clean)
                gpu_sentence = ''
                for s in sentences:
                    s_clean = ' '.join(s.split())
                    if gpu_pattern.search(s_clean) and len(s_clean) >= 30:
                        gpu_sentence = s_clean[:300]
                        if len(s_clean) > 300:
                            gpu_sentence = gpu_sentence.rsplit(' ', 1)[0] + '...'
                        break
                insights.append({
                    'label': 'Hardware',
                    'text': gpu_sentence or ('Trained on: ' + ', '.join(unique_gpus)),
                    'gpus': unique_gpus,
                })

        result = {'repos': repos, 'insights': insights, 'authors': authors}
        if paper_title:
            result['title'] = paper_title
        _insights_cache[_cache_key] = result
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 502


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
        ctx = ssl._create_unverified_context()
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
            ctx = ssl._create_unverified_context()
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
            ctx = ssl._create_unverified_context()
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
        ctx = ssl._create_unverified_context()
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
            "http://localhost:11434/api/chat",
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
            "http://localhost:11434/api/chat",
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
        req = urllib.request.Request("http://localhost:11434/api/tags")
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


@bp.route('/api/annotate', methods=['POST'])
def annotate_page():
    """Annotate page text with key findings, contradictions, and claims to verify."""
    try:
        body = request.get_json(force=True, silent=True) or {}
        text = (body.get('text') or '').strip()
        url = (body.get('url') or '').strip()
        other_tabs = body.get('otherTabs') or []
        if not text:
            return jsonify({'error': 'text required'}), 400

        # Check in-memory cache (5 min TTL)
        now = time.time()
        cache_key = f'annotate:{url}' if url else None
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

        prompt = (
            "You are a critical reading assistant. Analyze the following web page text and find 5-12 passages that are:\n"
            "1. KEY_FINDING — important facts, conclusions, or data worth highlighting\n"
            "2. CONTRADICTION — statements that conflict with content from the other open tabs listed below\n"
            "3. VERIFY — claims that are unsubstantiated, surprising, or need fact-checking\n\n"
            "For each annotation provide a JSON object with:\n"
            "- \"type\": one of \"KEY_FINDING\", \"CONTRADICTION\", \"VERIFY\"\n"
            "- \"quote\": a passage copied EXACTLY from the page text (10-40 words). Do NOT paraphrase, reword, or summarize. Copy-paste the exact characters.\n"
            "- \"explanation\": a short reason (1 sentence)\n"
            "- \"conflictsWith\": (only for CONTRADICTION) the title of the other tab it conflicts with\n\n"
            "Rules:\n"
            "- CRITICAL: Every quote must be a VERBATIM substring of the page text. Do not change any words, punctuation, or capitalization.\n"
            "- Only use CONTRADICTION if there is an actual conflict with another tab\n"
            "- If no other tabs are provided, do not use CONTRADICTION type\n"
            "- Respond ONLY with a JSON array, no other text\n\n"
            "--- MAIN PAGE TEXT ---\n" + main_text + "\n--- END PAGE TEXT ---"
        )
        if tab_context:
            prompt += tab_context

        model = body.get('model') or 'qwen2.5:3b'
        print(f"[annotate] url={url[:80]} model={model} text_len={len(main_text)} tabs={len(other_tabs[:3])}")
        llm_payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "think": False,
            "options": {"temperature": 0, "num_predict": 4000}
        }).encode()
        llm_req = urllib.request.Request(
            "http://localhost:11434/api/chat",
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

        valid_types = {'KEY_FINDING', 'CONTRADICTION', 'VERIFY'}
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
                ann = {'type': atype, 'quote': snapped[:500], 'explanation': explanation[:300]}
                if atype == 'CONTRADICTION' and item.get('conflictsWith'):
                    ann['conflictsWith'] = item['conflictsWith'][:200]
                annotations.append(ann)

        # Cache result
        if cache_key:
            _annotate_cache[cache_key] = {'data': annotations, 'ts': now}

        return jsonify({'annotations': annotations})
    except Exception as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/api/knowledge-graph/similarities', methods=['POST'])
def knowledge_graph_similarities():
    body = request.get_json(force=True, silent=True) or {}
    links = body.get('links', [])
    if not links or not isinstance(links, list):
        return jsonify({'edges': []})
    threshold = float(body.get('threshold', 0.65))
    edges = pairwise_similarities(links, threshold=threshold)
    return jsonify({'edges': edges})
