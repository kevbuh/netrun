"""Annotation system - feedback, categories, prompts, and quality classification."""

import os
import json
import time
import hashlib
import urllib.request

from db import DIR, _get_db

# ── Annotation file paths ──

BLOCKED_TITLES_FILE = os.path.join(DIR, 'blocked_titles.json')
PROMPT_FILE = os.path.join(DIR, 'quality_prompt.txt')
ANNOTATION_PROMPT_FILE = os.path.join(DIR, 'annotation_prompt.txt')


# ── Default prompts ──

DEFAULT_VERDICT_PROMPT = (
    "You are a topic filter. Your job is to remove obvious junk from a feed reader.\n\n"
    "SKIP only if the title is clearly about: product reviews, buyer's guides, 'best X' roundups, "
    "deals, discounts, coupons, promo codes, gift guides, price comparisons, sales, "
    "VPN/mattress/sleep product reviews, TV/movie recommendations, recipes, fashion, "
    "celebrity gossip, rage bait, clickbait, SEO spam.\n\n"
    "KEEP everything else — science, technology, programming, news, culture, ideas, sports, "
    "politics, business, and anything that could be genuinely interesting to read.\n\n"
    "When in doubt, KEEP.\n\n"
    "Reply ONLY with KEEP or SKIP."
)


DEFAULT_SCORING_PROMPT = (
    "You are a relevance scorer for a general-interest reader who likes science, tech, ideas, and news.\n\n"
    "90-100: groundbreaking research, major discoveries, novel algorithms, important papers.\n"
    "80-89: significant releases, deep technical write-ups, compelling long-form journalism.\n"
    "70-79: solid content — interesting news, thoughtful analysis, useful tutorials, good discussions.\n"
    "60-69: decent content — general tech/science news, industry updates, opinion pieces with substance.\n"
    "40-59: mediocre — routine announcements, surface-level reporting, mildly interesting.\n"
    "20-39: low quality — listicles, rehashed takes, thin content.\n"
    "1-19: junk — product roundups, deals, SEO content, clickbait, engagement farming.\n"
    "0: spam.\n\n"
    "Be generous with interesting content. Most substantive articles should score 70+.\n\n"
    "Reply with ONLY a number 0-100."
)


# Default prompt hashes for cache lookups
_DEFAULT_PROMPT_HASH = hashlib.sha256(
    (DEFAULT_VERDICT_PROMPT).encode()
).hexdigest()[:16]

_DEFAULT_SCORING_HASH = hashlib.sha256(
    (DEFAULT_SCORING_PROMPT).encode()
).hexdigest()[:16]


# ── Blocked titles ──

def read_blocked_titles():
    if not os.path.exists(BLOCKED_TITLES_FILE):
        return []
    with open(BLOCKED_TITLES_FILE, 'r') as f:
        return json.load(f)


def write_blocked_titles(titles):
    with open(BLOCKED_TITLES_FILE, 'w') as f:
        json.dump(titles, f, indent=2)


# ── Quality and annotation prompts ──

def read_prompt():
    """Read the custom prompt from disk, or return None if not set."""
    if os.path.exists(PROMPT_FILE):
        with open(PROMPT_FILE, 'r') as f:
            text = f.read().strip()
            return text if text else None
    return None


def write_prompt(prompt):
    """Write a custom prompt to disk. Pass None/empty to delete."""
    if not prompt or not prompt.strip():
        if os.path.exists(PROMPT_FILE):
            os.remove(PROMPT_FILE)
    else:
        with open(PROMPT_FILE, 'w') as f:
            f.write(prompt.strip())


def read_annotation_prompt():
    """Read the custom annotation prompt from disk, or return None if not set."""
    if os.path.exists(ANNOTATION_PROMPT_FILE):
        with open(ANNOTATION_PROMPT_FILE, 'r') as f:
            text = f.read().strip()
            return text if text else None
    return None


def write_annotation_prompt(prompt):
    """Write a custom annotation prompt to disk. Pass None/empty to delete."""
    if not prompt or not prompt.strip():
        if os.path.exists(ANNOTATION_PROMPT_FILE):
            os.remove(ANNOTATION_PROMPT_FILE)
    else:
        with open(ANNOTATION_PROMPT_FILE, 'w') as f:
            f.write(prompt.strip())


def annotation_prompt_mtime():
    """Return mtime of annotation prompt file, or None."""
    if os.path.exists(ANNOTATION_PROMPT_FILE):
        return os.path.getmtime(ANNOTATION_PROMPT_FILE)
    return None


# ── Annotation feedback (SQLite) ──

def store_annotation_feedback(url, page_title, quote, explanation, ann_type, rating):
    conn = _get_db()
    conn.execute(
        "INSERT INTO annotation_feedback (url, page_title, quote, explanation, ann_type, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (url or '', page_title or '', quote, explanation or '', ann_type or '', rating, time.time())
    )
    conn.commit()
    conn.close()


def list_annotation_feedback(rating=None, limit=100, offset=0):
    conn = _get_db()
    if rating:
        rows = conn.execute(
            "SELECT id, url, page_title, quote, explanation, ann_type, rating, created_at FROM annotation_feedback WHERE rating = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (rating, limit, offset)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, url, page_title, quote, explanation, ann_type, rating, created_at FROM annotation_feedback ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        ).fetchall()
    conn.close()
    return [{'id': r[0], 'url': r[1], 'page_title': r[2], 'quote': r[3], 'explanation': r[4], 'ann_type': r[5], 'rating': r[6], 'created_at': r[7]} for r in rows]


def update_annotation_feedback_rating(feedback_id, rating):
    conn = _get_db()
    conn.execute("UPDATE annotation_feedback SET rating = ? WHERE id = ?", (rating, feedback_id))
    conn.commit()
    conn.close()


def delete_annotation_feedback(feedback_id):
    conn = _get_db()
    conn.execute("DELETE FROM annotation_feedback WHERE id = ?", (feedback_id,))
    conn.commit()
    conn.close()


def get_annotation_feedback_stats():
    conn = _get_db()
    good = conn.execute("SELECT COUNT(*) FROM annotation_feedback WHERE rating = 'good'").fetchone()[0]
    bad = conn.execute("SELECT COUNT(*) FROM annotation_feedback WHERE rating = 'bad'").fetchone()[0]
    conn.close()
    return {'good': good, 'bad': bad}


# ── Annotation categories ──

def list_annotation_categories():
    conn = _get_db()
    rows = conn.execute("SELECT key, name, description, color, created_at FROM annotation_categories ORDER BY created_at").fetchall()
    conn.close()
    return [{'key': r[0], 'name': r[1], 'description': r[2], 'color': r[3], 'created_at': r[4]} for r in rows]


def add_annotation_category(key, name, description, color):
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO annotation_categories (key, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
        (key, name, description, color or '#888888', time.time())
    )
    conn.commit()
    conn.close()


def delete_annotation_category(key):
    conn = _get_db()
    conn.execute("DELETE FROM annotation_categories WHERE key = ?", (key,))
    conn.commit()
    conn.close()


# ── Quality classification via Ollama ──

def classify_title(title, system_msg=None):
    """Classify a single title as 'keep' or 'skip' via Ollama."""
    if system_msg is None:
        system_msg = DEFAULT_VERDICT_PROMPT
    payload = json.dumps({
        "model": "qwen3:8b",
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": title}
        ],
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": 3}
    }).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp_data = json.loads(resp.read())
    raw = resp_data.get("message", {}).get("content", "").strip()
    return "keep" if raw.upper().startswith("KEEP") else "skip"
