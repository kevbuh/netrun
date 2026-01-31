# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

### 1. Start Ollama (for AI quality filter)

```bash
brew services start ollama
```

Runs on `http://localhost:11434`. Required model: `qwen2.5:1.5b`. Pull it once with:

```bash
ollama pull qwen2.5:1.5b
```

Ollama is optional — the app works without it, but the AI quality filter will have no effect.

### 2. Start the server

```bash
python3 arxiv-filter/server.py
```

Starts an HTTP server on port 8000 serving the app at `http://localhost:8000`.

## Architecture

Self-contained feed reader, paper browser, and experiment tracker — vanilla JavaScript frontend, Python stdlib backend, no build step.

### Backend — `arxiv-filter/server.py` + `persistence.py` + `kernels.py`

Python HTTP server (`http.server`) that acts as an API proxy and local data store. Helper functions are split into `persistence.py` (file I/O, prompts, caching, classification) and `kernels.py` (Jupyter kernel management).

- `/feed` — proxies arXiv CS RSS feed
- `/hn-feed` — proxies Hacker News top stories API
- `/api/rss-proxy?url=` — generic RSS proxy for any feed URL (used by all non-special sources)
- `/api/arxiv-search` — proxies arXiv search API
- `/api/citations` — fetches citation counts from Semantic Scholar batch API
- `/api/quality-filter` — POST batch of titles to local Ollama for AI classification; supports two modes: `verdict` (KEEP/SKIP) and `score` (0-10 relevance rating)
- `/api/quality-prompt` — GET returns current verdict prompt, default prompt, and scoring prompt; PUT saves a custom verdict prompt to `quality_prompt.txt`
- `/api/blocked-titles` — GET/POST/DELETE for the prompt test suite titles, stored in `blocked_titles.json`
- `/api/experiments` — CRUD for experiments and their versions, stored as JSON files in `arxiv-filter/experiments/`
- `/api/check-embed` — checks if a URL can be embedded in an iframe
- `/api/extract-text` — POST a URL, returns extracted text (PDF via PyMuPDF for arXiv, HTML text extraction for other sites)
- `/api/paper-insights` — POST a URL, returns extracted repo links and key insights from the document

Experiments are stored on disk as `experiments/{slug}/meta.json`.

**Server-side files:**
- `quality_prompt.txt` — custom verdict prompt (created when user saves a non-default prompt; deleted on reset)
- `blocked_titles.json` — titles that must be classified as SKIP (prompt test suite)

### Frontend — `arxiv-filter/index.html` + `js/` + `styles.css`

Multi-file SPA (no build step). HTML skeleton in `index.html`, CSS in `styles.css`, JS split across 14 files in `js/`. Views managed by client-side hash routing:

1. **Onboarding** (`#`) — shown on first visit (no `feedSources` in localStorage) or when all sources are off. 2×N grid of source cards grouped by category, user picks sources, clicks "Start reading"
2. **Home** (`#`) — multi-source feed with masonry grid, sorting (latest/most cited), trend panels, infinite scroll, search
3. **Paper Viewer** (`#view/` or `#paper/`) — arXiv papers use full PDF viewer (highlights, pen, search); non-arXiv posts show the original website in an iframe. Both get sidebar with insights, chat, notes, and comments.
4. **Reading List** (`#saved`) — bookmarked posts with read/unread tracking
5. **Experiments List** (`#experiments`) — create/delete experiment ideas, sorted by last modified (includes file mtimes)
6. **Experiment Detail** (`#experiment/{id}`) — version tree with SVG visualization, interactive version cards, auto-save (600ms debounce), branching
7. **Quality Filter** (`#quality`) — dedicated sidebar tab for AI filter management: prompts, scoring threshold, blocked posts, test suite, cache stats

### File Structure

```
arxiv-filter/
  index.html            — HTML skeleton, Tailwind config, <link>/<script> tags
  styles.css            — CSS variables, dark/light themes, toggle switch, masonry, CodeMirror overrides
  server.py             — HTTP server, API proxy, request handler
  persistence.py        — file-path constants, read/write helpers, slugify, prompts, classify_title, cached_fetch
  kernels.py            — Jupyter kernel management, code execution (sync + streaming)
  js/
    core.js             — globals, constants, FEED_CATALOG, utilities, routing, view management
    pixel-pet.js        — pixel pet system (IIFE: rendering, AI states, mouse interaction)
    feed.js             — feed loading/parsing/rendering, reading list, citations, trends
    quality.js          — AI quality filter (Ollama integration, prompts, scoring, test suite)
    settings.js         — settings view (themes, accent, spinners, feed sources, quality filter UI), applyStoredAppearance
    dashboard.js        — dashboard view (activity heatmap, reading list, recent experiments, quotes)
    views.js            — paper viewer, sidebar panels (insights, chat, notes, comments), read progress
    search.js           — search view (feed search, arXiv search, OpenAlex, search history)
    calendar.js         — calendar view (month grid, event CRUD)
    whiteboard.js       — whiteboard view (multi-board canvas drawing, stroke eraser)
    pdfviewer.js        — PDF viewer (highlights, pen, search)
    experiments.js      — experiment list/detail, rename, description, file sidebar
    editors.js          — markdown/python editors, file management helpers
    notebook-editor.js  — notebook editor (cell management, kernel status, venv, packages)
```

**Script load order** (bottom of `<body>`): `core.js` → `pixel-pet.js` → `feed.js` → `quality.js` → `settings.js` → `dashboard.js` → `views.js` → `search.js` → `calendar.js` → `whiteboard.js` → `pdfviewer.js` → `experiments.js` → `editors.js` → `notebook-editor.js`. Order matters: core first (globals/utils), feed second (`renderPapers` used by quality), quality third, then settings/dashboard/views/search/calendar/whiteboard/experiments/editors/notebook-editor. All functions are global (no modules).

### Sidebar

The left sidebar (`60px` wide) has buttons for: Home, Experiments, Reading List (with unread badge), Calendar, and Settings (gear icon).

### Feed System

All available feeds are defined in `FEED_CATALOG` (JS array). Each entry has: `key`, `name`, `desc`, `cat` (category), `url` (RSS URL or null for special fetchers), `special` (`'arxiv'` or `'hn'` for custom fetch functions), and logo properties (`letter`, `bg`, `fg`, or `img`).

Adding a new feed source requires only appending to `FEED_CATALOG` in `js/core.js` — the onboarding grid, settings toggles, `loadAllFeeds()`, source chip rendering, and paper viewer source names all derive from it.

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

The quality filter has its own sidebar tab (`#quality`). It uses a two-phase pipeline via local Ollama (`qwen2.5:1.5b`):

**Phase 1 — Verdict (KEEP/SKIP):** Each post title is classified as KEEP or SKIP using a configurable system prompt (`DEFAULT_VERDICT_PROMPT`). Posts classified as SKIP are hidden from the feed. The verdict prompt is editable in the Quality Filter tab and can be saved (synced to server as `quality_prompt.txt`).

**Phase 2 — Scoring (0-10):** Posts that pass the verdict are scored 0-10 for relevance using `DEFAULT_SCORING_PROMPT` (read-only, displayed in the tab). Posts below the threshold (default: 8) are hidden. The threshold is adjustable via a slider in the Quality Filter tab.

**Evaluation flow:** `qualityFilterPapers()` runs after feeds load. It has a concurrency guard (`_qfRunning` / `_qfQueued`) to prevent overlapping requests. While evaluation is in progress, an inline indicator (`● Evaluating N…`) appears next to the Latest/Most Cited sort buttons. Posts awaiting evaluation are hidden from the feed until classified.

**Cache:** Results are stored in `localStorage.qualityCache` as `{ title: { v: 'keep'|'skip', s: number|null } }`. Each card shows a green ✓ with the score for kept posts.

**Prompt test suite:** Titles hidden via ✕ are collected in `localStorage.qualityTestTitles` (also synced to `blocked_titles.json` on server). Users can run these titles against the current prompt in the Quality Filter tab to verify all are classified as SKIP. The "Save prompt" button runs the test first — if any title is classified as KEEP, the save is blocked and failures are shown.

**Reset all & clear cache:** A single button in the Quality Filter tab resets the verdict prompt to default, resets the threshold to 8, clears the quality cache, and re-triggers evaluation.

### Post Actions

Each feed card has two action buttons (top-right corner):
- **Bookmark** — saves to Reading List (`localStorage.savedPosts`)
- **Hide (✕)** — permanently hides the post from the feed (`localStorage.hiddenPosts`) and adds its title to the prompt test suite (`localStorage.qualityTestTitles`)

Clicking a post marks it as read (`localStorage.readPosts`). Read posts render at 50% opacity with muted title text in both card and compact views.

### External APIs

- arXiv RSS: `https://rss.arxiv.org/rss/cs`
- arXiv API: `https://export.arxiv.org/api/query`
- Hacker News: `https://hacker-news.firebaseio.com/v0/`
- Semantic Scholar: `https://api.semanticscholar.org/graph/v1/paper/batch`
- Ollama (local): `http://localhost:11434/api/chat`

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `feedSources` | `{ key: boolean }` — which catalog feeds are enabled |
| `customFeeds` | Array of `{ url, name, enabled }` for user-added RSS feeds |
| `qualityFilter` | `'on'` or `'off'` — AI filter toggle state |
| `qualityPrompt` | Custom verdict prompt (if different from default) |
| `qualityThreshold` | `0-10` integer — minimum score to display (default 8) |
| `qualityCache` | `{ title: { v: 'keep'\|'skip', s: number\|null } }` — cached verdicts and scores |
| `hiddenPosts` | Array of post URLs permanently hidden by user |
| `savedPosts` | `{ url: { paper, savedAt, read } }` — reading list |
| `readPosts` | Array of post URLs that have been clicked/opened |
| `qualityTestTitles` | Array of strings — titles that must be classified as SKIP (prompt test suite) |

## Key Conventions

- UI uses a dark theme (and light theme) with accent color `#b4451a`
- Tailwind CSS loaded via CDN (`https://cdn.tailwindcss.com`) with custom theme colors mapped to CSS variables
- No frameworks, bundlers, or package managers — all vanilla
- No tests or linting configured
- Experiment slugs are generated via `slugify()` in `server.py`
- All feed-related rendering is data-driven from `FEED_CATALOG`
- `getSourceChip(source, arxivId)` resolves any source key to its inline logo + name
- Quality filter prompts are defined as constants in `persistence.py` (`DEFAULT_VERDICT_PROMPT`, `DEFAULT_SCORING_PROMPT`) and mirrored in `js/quality.js` (`DEFAULT_QUALITY_PROMPT`)
