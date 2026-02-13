"""Vector embeddings and semantic search - Ollama embeddings, similarity, chat memories."""

import json
import hashlib
import time
import struct
import math
import urllib.request

from db import _get_db
from routes.common import OLLAMA_HOST


# ── Embedding helper functions ──

def _embedding_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()[:20]


def _pack_embedding(vec):
    return struct.pack(f'{len(vec)}f', *vec)


def _unpack_embedding(blob, dim):
    return struct.unpack(f'{dim}f', blob)


def _cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ── Ollama embedding functions ──

def embed_text_ollama(text):
    """Call Ollama embed API with nomic-embed-text. Returns list of floats or None."""
    try:
        payload = json.dumps({"model": "nomic-embed-text", "input": text[:2000]}).encode()
        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/embed",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        embeddings = data.get("embeddings")
        if embeddings and len(embeddings) > 0:
            return embeddings[0]
        return None
    except Exception:
        return None


def store_embedding(text, title, link, source='', content_type='post'):
    """Embed text and store in DB. Skips if already exists."""
    ch = _embedding_hash(text)
    conn = _get_db()
    exists = conn.execute("SELECT 1 FROM embeddings WHERE content_hash = ?", (ch,)).fetchone()
    if exists:
        conn.close()
        return True
    vec = embed_text_ollama(text)
    if not vec:
        conn.close()
        return False
    blob = _pack_embedding(vec)
    conn.execute(
        "INSERT OR IGNORE INTO embeddings (content_hash, content_type, title, link, source, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (ch, content_type, title, link, source, blob, len(vec), time.time())
    )
    conn.commit()
    conn.close()
    return True


def search_embeddings(query_vec, content_type=None, limit=20, exclude_link=None):
    """Brute-force cosine search over all embeddings. Returns top N {title, link, source, score}."""
    conn = _get_db()
    if content_type:
        rows = conn.execute("SELECT title, link, source, embedding, dim FROM embeddings WHERE content_type = ?", (content_type,)).fetchall()
    else:
        rows = conn.execute("SELECT title, link, source, embedding, dim FROM embeddings").fetchall()
    conn.close()
    results = []
    for row in rows:
        if exclude_link and row['link'] == exclude_link:
            continue
        vec = _unpack_embedding(row['embedding'], row['dim'])
        score = _cosine_similarity(query_vec, vec)
        results.append({'title': row['title'], 'link': row['link'], 'source': row['source'], 'score': round(score, 4)})
    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:limit]


def pairwise_similarities(links, threshold=0.65):
    """Compute pairwise cosine similarities for a set of links that have embeddings.
    Returns list of { source, target, score } for pairs above threshold. Cap at 300 links."""
    links = links[:300]
    conn = _get_db()
    placeholders = ','.join('?' for _ in links)
    rows = conn.execute(
        f"SELECT link, embedding, dim FROM embeddings WHERE link IN ({placeholders})",
        links
    ).fetchall()
    conn.close()
    vecs = {}
    for row in rows:
        vecs[row['link']] = _unpack_embedding(row['embedding'], row['dim'])
    keys = list(vecs.keys())
    edges = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            score = _cosine_similarity(vecs[keys[i]], vecs[keys[j]])
            if score >= threshold:
                edges.append({'source': keys[i], 'target': keys[j], 'score': round(score, 4)})
    return edges


# ── Chat memory functions ──

def store_chat_memory(summary, topics, page_url='', page_title='', message_count=0):
    """Embed a chat summary and store in chat_memories table."""
    vec = embed_text_ollama(summary)
    blob = _pack_embedding(vec) if vec else None
    dim = len(vec) if vec else 0
    conn = _get_db()
    conn.execute(
        "INSERT INTO chat_memories (summary, topics, page_url, page_title, message_count, embedding, dim, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (summary, topics, page_url, page_title, message_count, blob, dim, time.time())
    )
    conn.commit()
    conn.close()


def search_chat_memories(query_vec, limit=3):
    """Cosine search over recent chat memories. Returns top N {id, summary, topics, page_title, score}."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, summary, topics, page_title, embedding, dim FROM chat_memories WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    results = []
    for row in rows:
        vec = _unpack_embedding(row['embedding'], row['dim'])
        score = _cosine_similarity(query_vec, vec)
        results.append({
            'id': row['id'],
            'summary': row['summary'],
            'topics': row['topics'],
            'page_title': row['page_title'],
            'score': round(score, 4)
        })
    results.sort(key=lambda x: x['score'], reverse=True)
    return results[:limit]


def list_chat_memories(limit=50, offset=0):
    """List chat memories ordered by recency. Returns {memories: [...], total: N}."""
    conn = _get_db()
    total = conn.execute("SELECT COUNT(*) FROM chat_memories").fetchone()[0]
    rows = conn.execute(
        "SELECT id, summary, topics, page_title, page_url, message_count, created_at FROM chat_memories ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset)
    ).fetchall()
    conn.close()
    return {
        'memories': [dict(r) for r in rows],
        'total': total
    }


def delete_chat_memory(memory_id):
    """Delete a single chat memory by id."""
    conn = _get_db()
    conn.execute("DELETE FROM chat_memories WHERE id = ?", (memory_id,))
    conn.commit()
    conn.close()


def get_memory_stats():
    """Aggregate stats: total count, date range, top 10 topics."""
    conn = _get_db()
    row = conn.execute(
        "SELECT COUNT(*) as cnt, MIN(created_at) as oldest, MAX(created_at) as newest FROM chat_memories"
    ).fetchone()
    total = row['cnt']
    oldest = row['oldest']
    newest = row['newest']
    # Aggregate topics
    topic_rows = conn.execute("SELECT topics FROM chat_memories WHERE topics IS NOT NULL AND topics != ''").fetchall()
    conn.close()
    freq = {}
    for tr in topic_rows:
        for t in tr['topics'].split(','):
            t = t.strip().lower()
            if t:
                freq[t] = freq.get(t, 0) + 1
    top_topics = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:10]
    return {
        'total_count': total,
        'oldest_ts': oldest,
        'newest_ts': newest,
        'top_topics': [{'topic': t, 'count': c} for t, c in top_topics]
    }
