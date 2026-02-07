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
python3 src/server.py
```

Starts an HTTP server on port 8000 serving the app at `http://localhost:8000`.

## Architecture

Self-contained feed reader, paper browser, and experiment tracker — vanilla JavaScript frontend, Python stdlib backend, no build step. **Optimized for running in the browser** (not Electron) — always prioritize the web browser experience when making decisions about navigation, tabs, popups, and link handling.

### Backend — `src/server.py` + `persistence.py` + `kernels.py`

Python HTTP server (`http.server`) that acts as an API proxy and local data store. Helper functions are split into `persistence.py` (file I/O, prompts, caching, classification) and `kernels.py` (Jupyter kernel management).

- `/feed` — proxies arXiv CS RSS feed
- `/hn-feed` — proxies Hacker News top stories API
- `/api/rss-proxy?url=` — generic RSS proxy for any feed URL (used by all non-special sources)
- `/api/arxiv-search` — proxies arXiv search API
- `/api/citations` — fetches citation counts from Semantic Scholar batch API
- `/api/quality-filter` — POST batch of titles to local Ollama for AI classification; supports two modes: `verdict` (KEEP/SKIP) and `score` (0-10 relevance rating)
- `/api/quality-prompt` — GET returns current verdict prompt, default prompt, and scoring prompt; PUT saves a custom verdict prompt to `quality_prompt.txt`
- `/api/blocked-titles` — GET/POST/DELETE for the prompt test suite titles, stored in `blocked_titles.json`
- `/api/experiments` — CRUD for experiments and their versions, stored as JSON files in `src/experiments/`
- `/api/check-embed` — checks if a URL can be embedded in an iframe
- `/api/extract-text` — POST a URL, returns extracted text (PDF via PyMuPDF for arXiv, HTML text extraction for other sites)
- `/api/paper-insights` — POST a URL, returns extracted repo links and key insights from the document

Experiments are stored on disk as `experiments/{slug}/meta.json`.

**Server-side files:**
- `quality_prompt.txt` — custom verdict prompt (created when user saves a non-default prompt; deleted on reset)
- `blocked_titles.json` — titles that must be classified as SKIP (prompt test suite)

### Frontend — `src/index.html` + `js/` + `styles.css`

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
src/
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
    views.js            — paper viewer core (reader view, topbar overflow, sidebar resize)
    paper-sidebar.js    — paper sidebar panels (insights, notes, comments, citations, references)
    chat-threads.js     — document chat, thread persistence, sidebar tabs
    panel.js            — unified popup panel system, context menus, slash commands
    browse-tabs.js      — browse tab/window management, downloads, navigation
    browse-urlbar.js    — URL bar, instant answers, history, ad blocker
    search.js           — search view (feed search, arXiv search, OpenAlex, search history)
    calendar.js         — calendar view (month grid, event CRUD)
    whiteboard.js       — whiteboard view (multi-board canvas drawing, stroke eraser)
    pdfviewer.js        — PDF viewer (highlights, pen, search)
    teams.js            — team collaboration features
    experiments.js      — experiment list/detail, rename, description, file sidebar
    editors.js          — markdown/python editors, file management helpers
    notebook-editor.js  — notebook editor (cell management, kernel status, venv, packages)
    draw-editor.js      — drawing editor
    slides-editor.js    — slides editor
    terminal.js         — terminal emulator
    vault.js            — vault (notes) management
    vibe.js             — vibe coding assistant
    neuralook.js        — neural network visualization
```

**Script load order** (bottom of `<body>`): `core.js` → `pixel-pet.js` → `feed.js` → `quality.js` → `settings.js` → `dashboard.js` → `views.js` → `paper-sidebar.js` → `chat-threads.js` → `panel.js` → `browse-tabs.js` → `browse-urlbar.js` → `search.js` → `calendar.js` → `whiteboard.js` → `pdfviewer.js` → `teams.js` → `experiments.js` → `editors.js` → `notebook-editor.js` → `draw-editor.js` → `slides-editor.js` → `terminal.js` → `vault.js` → `vibe.js` → `neuralook.js`. Order matters: core first (globals/utils), feed second (`renderPapers` used by quality), quality third, then settings/dashboard, then views → paper-sidebar → chat-threads → panel (popup system depends on views), then browse-tabs → browse-urlbar → search (browse depends on panel), then remaining views. All functions are global (no modules).

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

### Lookup Panel

The lookup panel is the unified right-click interaction surface across the app. It opens on right-click (`contextmenu`) anywhere and provides an inline chat input, context-aware actions, and drag-to-screenshot capture.

**Opening:** Right-click anywhere opens the panel at the cursor position. It starts in track mode (`_lookupTrackMode = true`), following the cursor until the user interacts. Left-click dismisses it.

**Context-aware content:** When right-clicking on links or images, the panel shows relevant actions (Open Link, Copy Address, etc.) via `contextData` passed to `_showLookupPanel()`. Otherwise it shows a blank chat input.

**Inline chat:** The panel includes a chat input (`Ask anything…`) that sends messages to `/api/doc-chat` via SSE streaming (Enter). Chat history is maintained in `_popupChatMessages`. Messages can be moved to the sidebar chat via "Open in sidebar". In the paper viewer, the first message includes document context (`_docText`).

**Web search:** Pressing Shift+Enter in the input performs a web search via `/api/web-search`, displaying results inline in the panel.

**Keyboard navigation:** All dropdowns and option lists in the lookup panel (command autocomplete, `/tabs`, `/tab`, `/notes`, `/model`, `/history`, `/links`) must be fully keyboard-navigable: Arrow Up/Down to move selection, Enter to confirm, Escape to dismiss. Any new dropdown or option list added to the panel should follow this same pattern.

**Text selection popup:** Selecting text replaces the lookup panel with a selection popup showing Quote, Lookup (single words), and highlight color dots (in PDF). The selection popup also has an inline chat input.

**Drag-to-screenshot (Electron only):** While the lookup panel is open and tracking the cursor, left-click-dragging captures a screenshot of the dragged region. The panel pins in place, a dashed selection rectangle with dimmed overlay appears, and on mouseup the region is captured via `electronAPI.captureScreen()` (IPC to `BrowserWindow.capturePage()`). Screenshots appear as thumbnails in an attachment strip above the chat input. When sent, messages with screenshots go to `/api/doc-chat` with `vision: true`, using the `deepseek-ocr` vision model instead of `qwen2.5:3b`.

**Key state variables (in `js/views.js`):**
- `_lookupTrackMode` — whether the panel tracks the cursor
- `_popupChatMessages` — chat message history for the current panel
- `_pendingScreenshots` — base64 PNG strings awaiting send
- `_screenshotDragStart` — tracks active screenshot drag
- `_popupChatAbort` — AbortController for in-flight chat requests

**Key functions:**
- `_showLookupPanel(x, y, contextData)` — creates the panel
- `_sendPopupChatMessage(popup, capturedText)` — sends chat with optional vision support (Enter)
- `_doLookupWebSearch(popup)` — performs web search via `/api/web-search` (Shift+Enter)
- `_renderPopupChat(popup, final)` — renders chat messages, search results, and inline image thumbnails
- `_addScreenshotToPanel(popup, base64)` — adds screenshot thumbnail to attachment strip
- `_handleContextMenuChat(e)` — right-click handler that opens the panel

**Electron IPC (`electron/main.js` + `electron/preload.js`):**
- `ipcMain.handle('capture-screen', ...)` — captures a rectangular region of the window
- `electronAPI.captureScreen(rect)` — exposed to renderer via preload

**Server endpoints (`server.py`):**
- `/api/doc-chat` — POST, accepts `vision: true` for screenshot chat
- `/api/web-search?q=` — GET, DuckDuckGo HTML search, returns `{ results: [{title, url, snippet}] }`
- Vision mode uses `deepseek-ocr` model and passes `images` arrays through to Ollama
- `/api/images` POST — saves base64 PNG to `uploads/` directory, returns URL
- `/api/images/<filename>` GET — serves saved images

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

### Authentication & User Accounts

Users must sign in before accessing the app. A full-screen login gate blocks all content until authenticated.

**Backend (SQLite):** User data lives in `lookup.db` (auto-created on first run) with three tables:
- `users` — username (primary key), salted SHA-256 password hash, created timestamp
- `sessions` — token (primary key), username, expires (30-day TTL)
- `user_data` — per-user key-value store for synced settings (username + key composite PK)

**Auth endpoints:**
- `POST /api/auth/register` — create account (username 2-30 chars, password 4+ chars), returns session token
- `POST /api/auth/login` — verify credentials, returns session token
- `POST /api/auth/logout` — delete session (requires `Authorization: Bearer <token>`)
- `GET /api/auth/me` — validate session, returns `{ username }`
- `POST /api/sync` — bidirectional settings sync (last-write-wins by timestamp per key)

**Frontend flow:**
1. On page load, `core.js` checks for a stored `authToken` in localStorage
2. If no token or token is expired → show login gate (covers entire app)
3. On successful login → pull settings from server, hide gate, start 60s sync interval
4. On register → push current localStorage defaults to server as initial settings
5. Account button in sidebar opens a modal to sync or sign out

**Synced settings (`SYNC_KEYS`):** feedSources, customFeeds, qualityFilter, qualityPrompt, qualityThreshold, qualityCache, hiddenPosts, savedPosts, readPosts, qualityTestTitles, paperRatings, theme, accentColor, spinner, userName, sidebarOrder, clickSound, clickSoundType, rainNoiseType, rainVolume, editorTheme, rainSidebarVisible

**Design:** This is a placeholder auth system. The username/password flow is structured to be easily replaceable with Google Sign-In or any OAuth provider — just swap the login form and the `/api/auth/register` + `/api/auth/login` endpoints. Sessions, sync, and per-user data storage remain unchanged.

## Key Conventions

- UI uses a dark theme (and light theme) with accent color `#b4451a`
- Tailwind CSS loaded via CDN (`https://cdn.tailwindcss.com`) with custom theme colors mapped to CSS variables
- No frameworks, bundlers, or package managers — all vanilla
- No tests or linting configured
- Experiment slugs are generated via `slugify()` in `server.py`
- All feed-related rendering is data-driven from `FEED_CATALOG`
- `getSourceChip(source, arxivId)` resolves any source key to its inline logo + name
- Quality filter prompts are defined as constants in `persistence.py` (`DEFAULT_VERDICT_PROMPT`, `DEFAULT_SCORING_PROMPT`) and mirrored in `js/quality.js` (`DEFAULT_QUALITY_PROMPT`)
