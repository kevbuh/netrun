"""Content/document routes: doc-chat, extract-text, extract-links, paper-insights,
author-details, citation-lookup, paper-references, author-lookup, citations,
panel-suggest, search-suggest."""
import concurrent.futures
import json
import os
import re
import ssl
import tempfile
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
)

bp = Blueprint('content', __name__)

# ── Module-level caches ──

# In-memory cache for Semantic Scholar API responses to avoid rate limits
# Format: { cache_key: { 'data': ..., 'ts': timestamp } }
_s2_cache = {}
_S2_CACHE_TTL = 3600  # 1 hour

# In-memory cache for paper insights: url -> { repos, contribution }
_insights_cache = {}


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
        page_ctx = ''
        if tools_enabled:
            page_url = body.get('pageUrl', '')
            page_title = body.get('pageTitle', '')
            if page_url:
                page_ctx = f'\n\nThe user is currently viewing: "{page_title}" ({page_url}). Use this when they refer to "this page", "this paper", etc.'
        if truncated_ctx:
            system_msg = (
                "You are a helpful research assistant. The user is reading a document. "
                "Answer their questions based on the document text below when relevant. "
                "You also have tools available to search the web, find papers, fetch pages, "
                "bookmark posts, navigate the app, and create experiments." + page_ctx + "\n\n"
                "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
            ) if tools_enabled else (
                "You are a helpful research assistant. The user is reading a document. "
                "Answer their questions based ONLY on the document text below. "
                "Do not make up information that is not in the document.\n\n"
                "--- DOCUMENT TEXT ---\n" + truncated_ctx + "\n--- END ---"
            )
        else:
            system_msg = (
                "You are a helpful assistant with tools to search the web, find papers, "
                "fetch page content, bookmark posts, navigate the app, and create experiments. "
                "Use tools when they would help answer the user's question." + page_ctx
            ) if tools_enabled else "You are a helpful assistant."
        ollama_messages = [{"role": "system", "content": system_msg}] + messages

    def generate():
        try:
            nonlocal tools_enabled, ollama_messages, model
            # Tool call loop (max 5 iterations)
            if tools_enabled:
                for _ in range(5):
                    payload = json.dumps({
                        "model": model,
                        "messages": ollama_messages,
                        "tools": CHAT_TOOLS,
                        "stream": False
                    }).encode()
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
                        ollama_messages.append({"role": "tool", "content": json.dumps(tool_result)})
                else:
                    # Exhausted iterations -- do final call without tools
                    pass

            # Final streaming call
            payload = json.dumps({
                "model": model,
                "messages": ollama_messages,
                "stream": True
            }).encode()
            req = urllib.request.Request(
                "http://localhost:11434/api/chat",
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                final_chunk = None
                for line in resp:
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
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


@bp.route('/api/paper-insights', methods=['POST'])
def paper_insights():
    try:
        body = request.get_json(force=True, silent=True) or {}
        url = body.get('url', '').strip()
        if not url:
            return jsonify({'error': 'url required'}), 400
        allow_heuristics = body.get('allowHeuristics', True)
        _cache_key = url + ('::h' if allow_heuristics else '::noh')
        # Cache read disabled for dev -- always fetch fresh

        # Reuse extract-text logic to get document text
        extracted = _do_extract_text(url)
        text = extracted['text']

        # 0. Extract authors from Semantic Scholar (includes stats)
        authors = []
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
                    s2_url = f'https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}?fields=authors.authorId,authors.name,authors.affiliations'
                    s2_req = urllib.request.Request(s2_url, headers={'User-Agent': 'Mozilla/5.0'})
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(s2_req, timeout=10, context=ctx) as s2_resp:
                        s2_data = json.loads(s2_resp.read())
                    print(f'[paper-insights] S2 paper authors: {len(s2_data.get("authors", []))} authors')
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
