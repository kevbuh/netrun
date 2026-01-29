# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

### 1. Start Ollama (for AI quality filter)

```bash
brew services start ollama
```

Runs on `http://localhost:11434`. Required model: `qwen2.5:0.5b`. Pull it once with:

```bash
ollama pull qwen2.5:0.5b
```

Ollama is optional — the app works without it, but the AI quality filter in settings will have no effect.

### 2. Start the server

```bash
python3 arxiv-filter/server.py
```

Starts an HTTP server on port 8000 serving the app at `http://localhost:8000`.

## Architecture

Self-contained feed reader, paper browser, and experiment tracker — vanilla JavaScript frontend, Python stdlib backend, no build step.

### Backend — `arxiv-filter/server.py`

Python HTTP server (`http.server`) that acts as an API proxy and local data store:

- `/feed` — proxies arXiv CS RSS feed
- `/hn-feed` — proxies Hacker News top stories API
- `/api/rss-proxy?url=` — generic RSS proxy for any feed URL (used by all non-special sources)
- `/api/arxiv-search` — proxies arXiv search API
- `/api/citations` — fetches citation counts from Semantic Scholar batch API
- `/api/quality-filter` — POST batch of titles to local Ollama for AI classification (keep/skip)
- `/api/experiments` — CRUD for experiments and their versions, stored as JSON files in `arxiv-filter/experiments/`
- `/api/check-embed` — checks if a URL can be embedded in an iframe

Experiments are stored on disk as `experiments/{slug}/meta.json`.

### Frontend — `arxiv-filter/index.html`

Single-file SPA (~2200 lines) with embedded CSS and JS. Views managed by client-side routing:

1. **Onboarding** — shown on first visit (no `feedSources` in localStorage) or when all sources are off. 2×N grid of source cards grouped by category, user picks sources, clicks "Start reading"
2. **Home** — multi-source feed with masonry grid, sorting (latest/most cited), trend panels, infinite scroll, search
3. **Paper Viewer** — split layout with metadata sidebar + embedded PDF iframe, citation counts
4. **Reading List** — bookmarked posts with read/unread tracking
5. **Experiments List** — create/delete experiment ideas
6. **Experiment Detail** — version tree with SVG visualization, interactive version cards, auto-save (600ms debounce), branching

### Feed System

All available feeds are defined in `FEED_CATALOG` (JS array). Each entry has: `key`, `name`, `desc`, `cat` (category), `url` (RSS URL or null for special fetchers), `special` (`'arxiv'` or `'hn'` for custom fetch functions), and logo properties (`letter`, `bg`, `fg`, or `img`).

Adding a new feed source requires only appending to `FEED_CATALOG` — the onboarding grid, settings toggles, `loadAllFeeds()`, source chip rendering, and paper viewer source names all derive from it.

**Built-in sources (15):**
- Research & Science: arXiv, Nature, Science, Quanta Magazine
- Tech & News: Hacker News, The Verge, Ars Technica, TechCrunch, Wired, MIT Tech Review
- Programming: Lobsters
- AI & Machine Learning: The Gradient
- Security: Krebs on Security
- Ideas & Culture: Aeon, Nautilus

Users can also add custom RSS feeds via settings.

**Source selection** is stored in `localStorage.feedSources` as `{ key: boolean }`. `FEED_SOURCE_DEFAULTS` has all keys `false`; first-time visitors see the onboarding screen.

### AI Quality Filter

When enabled in settings, titles of loaded posts are sent to `POST /api/quality-filter` in batches of 10. The server classifies each title via Ollama (`qwen2.5:0.5b`, temperature 0, 3 token limit) as `keep` or `skip`. Results are cached in `localStorage.qualityCache` so each title is only classified once.

In the feed, posts classified as `skip` are hidden. A green checkmark (✓) appears next to kept posts; a dim dot (●) appears while classification is pending.

The filter toggle state is stored in `localStorage.qualityFilter` (`'on'`/`'off'`).

**Prompt test suite:** Titles hidden via ✕ are collected in `localStorage.qualityTestTitles` as a "must-SKIP" test set. In settings, users can run these titles against the current prompt to verify all are classified as SKIP. The "Save prompt" button runs the test first — if any title is classified as KEEP, the save is blocked and failures are shown. Saving also clears the quality cache so existing posts get re-evaluated.

### Post Actions

Each feed card has two action buttons (top-right corner):
- **Bookmark** — saves to Reading List (`localStorage.savedPosts`)
- **Hide (✕)** — permanently hides the post from the feed (`localStorage.hiddenPosts`) and adds its title to the prompt test suite (`localStorage.qualityTestTitles`)

### External APIs

- arXiv RSS: `https://rss.arxiv.org/rss/cs`
- arXiv API: `https://export.arxiv.org/api/query`
- Hacker News: `https://hacker-news.firebaseio.com/v0/`
- Semantic Scholar: `https://api.semanticscholar.org/graph/v1/paper/batch`
- Ollama (local): `http://localhost:11434/api/generate`

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `feedSources` | `{ key: boolean }` — which catalog feeds are enabled |
| `customFeeds` | Array of `{ url, name, enabled }` for user-added RSS feeds |
| `qualityFilter` | `'on'` or `'off'` — AI filter toggle state |
| `qualityCache` | `{ title: 'keep'|'skip' }` — cached LLM verdicts |
| `hiddenPosts` | Array of post URLs permanently hidden by user |
| `savedPosts` | `{ url: { paper, savedAt, read } }` — reading list |
| `qualityTestTitles` | Array of strings — titles that must be classified as SKIP (prompt test suite) |

## Key Conventions

- UI uses a dark theme (and light theme) with accent color `#b4451a`
- Tailwind CSS loaded via CDN (`https://cdn.tailwindcss.com`) with custom theme colors mapped to CSS variables
- No frameworks, bundlers, or package managers — all vanilla
- No tests or linting configured
- Experiment slugs are generated via `slugify()` in `server.py`
- All feed-related rendering is data-driven from `FEED_CATALOG`
- `getSourceChip(source, arxivId)` resolves any source key to its inline logo + name
