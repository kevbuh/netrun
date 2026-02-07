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

### 2. Start the app

```bash
npm start
```

Launches the Electron app, which spawns the Flask server (`src/app.py`) as a child process. For the server only:

```bash
npm run server
```

## Architecture

Self-contained feed reader, paper browser, and experiment tracker — vanilla JavaScript frontend, Flask backend, Electron shell with a built-in custom browser. This is a **desktop app**, not a web app — Electron is the primary runtime. Memory efficiency matters because the user runs multiple local LLMs (via Ollama) alongside the app. Minimize RAM usage in both the Python server and the renderer process.

### Backend — Flask app in `src/`

Flask server (`src/app.py`) with routes split across blueprints in `src/routes/`. Helper modules:
- `helpers.py` — auth decorators, SSE helpers, chat tools, arxiv query builder
- `vault_helpers.py` — vault .md file I/O, git operations (shared by vault + social routes)
- `persistence.py` — DB schema (24 tables), read/write helpers, slugify, prompts, classify_title, cached_fetch
- `kernels.py` — Jupyter kernel management, code execution (sync + streaming)
- `feed_catalog.py` — server-side mirror of `FEED_CATALOG` from `js/core.js` (must be kept in sync)
- `feed_parser.py` — RSS/Atom/HN/Polymarket parsing using stdlib only (no external deps)
- `feed_poller.py` — background daemon polling all catalog sources every 10 minutes into SQLite `feed_items` table

**Key API endpoints:**
- `/feed` — proxies arXiv CS RSS feed
- `/hn-feed` — proxies Hacker News top stories API
- `/polymarket-feed` — proxies Polymarket breaking markets
- `/api/feed-items` — GET cached feed items from server-side poller
- `/api/feed-items/custom` — POST poll custom RSS feeds on demand
- `/api/rss-proxy?url=` — generic RSS proxy for any feed URL (used by all non-special sources)
- `/api/arxiv-search` — proxies arXiv search API
- `/api/citations` — fetches citation counts from Semantic Scholar batch API
- `/api/quality-filter` — POST batch of titles to local Ollama for AI classification; supports two modes: `verdict` (KEEP/SKIP) and `score` (0-100 relevance rating). Score mode accepts optional `interest_context` string to personalize scoring
- `/api/quality-prompt` — GET returns current verdict prompt, default prompt, and scoring prompt; PUT saves a custom verdict prompt to `quality_prompt.txt`
- `/api/blocked-titles` — GET/POST/DELETE for the prompt test suite titles, stored in `blocked_titles.json`
- `/api/experiments` — CRUD for experiments and their versions, stored as JSON files in `src/experiments/`
- `/api/check-embed` — checks if a URL can be embedded in an iframe
- `/api/extract-text` — POST a URL, returns extracted text (PDF via PyMuPDF for arXiv, HTML text extraction for other sites)
- `/api/paper-insights` — POST a URL, returns extracted repo links and key insights from the document
- `/api/doc-chat` — POST, SSE streaming chat with optional `vision: true` for screenshot chat
- `/api/web-search?q=` — GET, DuckDuckGo HTML search, returns `{ results: [{title, url, snippet}] }`
- `/api/images` — POST saves base64 PNG to `uploads/`, GET serves saved images

Experiments are stored on disk as `experiments/{slug}/meta.json`.

**Server-side files:**
- `quality_prompt.txt` — custom verdict prompt (created when user saves a non-default prompt; deleted on reset)
- `blocked_titles.json` — titles that must be classified as SKIP (prompt test suite)

### Frontend — `src/index.html` + `js/` + `styles.css`

Multi-file SPA (no build step). HTML skeleton in `index.html`, CSS in `styles.css`, JS split across 26 files in `js/`. HTML templates in `views/` are lazy-loaded via `VIEW_REGISTRY`. Views managed by client-side hash routing:

1. **Onboarding** (`#`) — shown on first visit (no `feedSources` in localStorage) or when all sources are off. 2×N grid of source cards grouped by category, user picks sources, clicks "Start reading"
2. **Feed** (`#feed`) — multi-source feed with masonry grid, sorting (latest/most cited/for you), trend panels, infinite scroll, search
3. **Dashboard** (`#saved`) — activity heatmap, reading list, recent experiments, quotes
4. **Research** (`#research`) — research view with tabs
5. **Paper Viewer** (`#view/` or `#paper/`) — arXiv papers use full PDF viewer (highlights, pen, search); non-arXiv posts show the original website in an iframe. Both get sidebar with insights, chat, notes, and comments.
6. **Browse** (`#browse`) — built-in browser with tabs, URL bar, ad blocker, downloads
7. **Experiments** (`#experiment/{id}`) — experiment detail with file sidebar, editors, kernel, venv
8. **Calendar** (`#calendar`) — month grid, event CRUD
9. **Vault** (`#vault`) — notes management with marimo integration
10. **Teams** (`#teams`, `#team/{id}`) — team collaboration, messages, todos
11. **Inbox** (`#inbox`) — unified inbox
12. **Terminal** (`#terminal`) — WebSocket terminal emulator
13. **Neuralook** (`#neuralook`) — neural network visualization
14. **Vibe** (`#vibe`) — vibe coding assistant
15. **Settings** (`#settings`) — themes, accent, spinners, feed sources, quality filter UI
16. **Quality Filter** (`#quality`) — AI filter management: prompts, scoring threshold, blocked posts, test suite, cache stats
17. **Profile** (`#profile/{username}`) — user profile, blog posts
18. **Author** (`#author/{id}`) — author profile view
19. **Dev** (`#dev`) — dev stats view

### File Structure

```
src/
  index.html            — HTML skeleton, Tailwind config, <link>/<script> tags
  styles.css            — CSS variables, dark/light themes, toggle switch, masonry, CodeMirror overrides
  app.py                — Flask app factory, CLI args, WebSocket terminal, static serving
  helpers.py            — auth decorators, SSE helpers, chat tools, arxiv query builder
  vault_helpers.py      — vault .md file I/O, git operations (shared by vault + social routes)
  persistence.py        — DB schema (24 tables), read/write helpers, slugify, prompts, classify_title, cached_fetch
  kernels.py            — Jupyter kernel management, code execution (sync + streaming)
  terminal_server.py    — WebSocket-to-pty bridge for flask-sock
  feed_catalog.py       — server-side feed catalog (mirror of JS FEED_CATALOG, must be kept in sync)
  feed_parser.py        — RSS/Atom/HN/Polymarket parsing (stdlib only, no external deps)
  feed_poller.py        — background feed polling daemon (10min interval, 8 concurrent, 30-day retention)
  views/                — 18 HTML templates lazy-loaded by VIEW_REGISTRY
  routes/
    auth.py             — 6 routes: login, logout, username, delete, me, sync
    feed.py             — 14 routes: feeds, RSS proxy, quality filter, models, feed-items
    experiments.py      — 29 routes: experiment CRUD, files, runs, kernel, venv, execute (SSE)
    social.py           — 51 routes: teams, users, messages, comments, blog, achievements
    content.py          — 11 routes: doc-chat (SSE), extract-text, paper-insights, citations
    browse.py           — 8 routes: web-search, browse-proxy, image-proxy, link-preview, stock-quote, adblock
    vault.py            — 10 routes: notes CRUD, marimo start/stop, vault path, vault tree
    misc.py             — 26 routes: neuralook (SSE), transcribe, vibe/git, todos, calendar, images, saved-content
  js/
    core.js             — globals, constants, FEED_CATALOG (166 sources), utilities, routing, window manager, view registry
    pixel-pet.js        — pixel pet system (IIFE: rendering, AI states, mouse interaction)
    feed.js             — feed loading/parsing/rendering, reading list, citations, trends, personalization panel
    quality.js          — AI quality filter (Ollama integration, prompts, scoring, test suite, interest profiling)
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

### Window Manager

The app uses a tiling/fullscreen window manager (`wmOpen()` in `core.js`) to manage views:

- **`_wmWindows`** — array of open windows `{ key, label, sidebarId }`
- **`_wmMode`** — `'fullscreen'` or `'tiling'`
- **`_wmViewMeta`** — maps view keys (dashboard, feed, research, vault, browse, inbox, terminal, neuralook, dev, vibe, settings, calendar) to sidebar IDs, labels, and open functions
- **`wmOpen(key)`** — opens or focuses a view, captures preview snapshot after 600ms
- **Tiling mode** (`Cmd+T`) — shows overlay with tile cards for all open windows using `html2canvas` previews; keyboard navigable (arrows, Enter, Backspace)
- **Fullscreen mode** — activates a single window via its `openFn()`

### Sidebar

The left sidebar (`60px` wide) has buttons for views (dashboard, feed, research, vault, browse, inbox, terminal, neuralook, dev, vibe, settings, calendar). Order is customizable via `localStorage.sidebarOrder`. Keyboard navigable (Up/Down arrows, Enter).

### Feed System

All available feeds are defined in `FEED_CATALOG` (JS array in `core.js`, mirrored in `feed_catalog.py`). Each entry has: `key`, `name`, `desc`, `cat` (category), `url` (RSS URL or null for special fetchers), `special` (`'arxiv'`, `'hn'`, or `'polymarket'` for custom fetch functions), and logo properties (`letter`, `bg`, `fg`, or `img`).

Adding a new feed source requires appending to both `FEED_CATALOG` in `js/core.js` and `CATALOG` in `feed_catalog.py` — the onboarding grid, settings toggles, `loadAllFeeds()`, source chip rendering, paper viewer source names, and server-side polling all derive from them.

**Built-in sources (166) across 14 categories:**
- Research & Science (7): arXiv, Nature, Science, Quanta Magazine, PNAS, Cell, NEJM
- Tech & News (6): Hacker News, The Verge, Ars Technica, TechCrunch, Wired, MIT Tech Review
- Programming (10): Lobsters, Go Blog, Rust Blog, Julia Blog, Python Insider, Swift Blog, Node.js Blog, Ruby News, PHP News, Zig News
- AI & Machine Learning (4): The Gradient, Distill, Google AI Blog, OpenAI Blog
- Security (1): Krebs on Security
- Ideas & Culture (5): Aeon, Nautilus, Longreads, The Marginalian, Works in Progress
- Sports (3): ESPN, The Athletic, Bleacher Report
- Prediction Markets (1): Polymarket (special fetcher)
- Design (2): Designer News, Sidebar
- Finance & Economics (3): Financial Times, The Economist, BIG by Matt Stoller
- Space (2): NASA, SpaceNews
- News & World (4): Reuters, BBC, NPR, AP News
- Blogs & Newsletters (35): Astral Codex Ten, Dwarkesh, geohot, Lilian Weng, colah, Gwern, LessWrong, Karpathy, Simon Willison, etc.
- HN Top Blogs 2025 (83): Daring Fireball, antirez, Pluralistic, Paul Graham, and many more

Users can also add custom RSS feeds via settings.

**Source selection** is stored in `localStorage.feedSources` as `{ key: boolean }`. First-time visitors see the onboarding screen.

**Server-side feed polling:** `feed_poller.py` runs a background daemon that fetches all catalog sources every 10 minutes using 8 concurrent threads. Items are stored in the `feed_items` SQLite table with 30-day retention. The frontend can fetch cached items via `/api/feed-items` instead of proxying RSS directly.

### AI Quality Filter

The quality filter has its own sidebar tab (`#quality`). It uses a two-phase pipeline via local Ollama (`qwen2.5:1.5b`):

**Phase 1 — Verdict (KEEP/SKIP):** Each post title is classified as KEEP or SKIP using a configurable system prompt (`DEFAULT_VERDICT_PROMPT`). Posts classified as SKIP are hidden from the feed. The verdict prompt is editable in the Quality Filter tab and can be saved (synced to server as `quality_prompt.txt`).

**Phase 2 — Scoring (0-100):** Posts that pass the verdict are scored 0-100 for relevance using `DEFAULT_SCORING_PROMPT` (read-only, displayed in the tab). Posts below the threshold (default: 30) are hidden. The threshold is adjustable via a slider in the Quality Filter tab. When personalization is active, the user's interest profile (`interest_context`) is appended to the scoring prompt to boost scores for content matching the user's interests.

**Evaluation flow:** `qualityFilterPapers()` runs after feeds load. It has a concurrency guard (`_qfRunning` / `_qfQueued`) to prevent overlapping requests. While evaluation is in progress, an inline indicator (`● Evaluating N…`) appears next to the Latest/Most Cited sort buttons. Posts awaiting evaluation are hidden from the feed until classified.

**Cache:** Results are stored in `localStorage.qualityCache` as `{ title: { v: 'keep'|'skip', s: number|null } }`. Each card shows a green ✓ with the score for kept posts.

**Prompt test suite:** Titles hidden via ✕ are collected in `localStorage.qualityTestTitles` (also synced to `blocked_titles.json` on server). Users can run these titles against the current prompt in the Quality Filter tab to verify all are classified as SKIP. The "Save prompt" button runs the test first — if any title is classified as KEEP, the save is blocked and failures are shown.

**Reset all & clear cache:** A single button in the Quality Filter tab resets the verdict prompt to default, resets the threshold to 30, clears the quality cache, and re-triggers evaluation.

### Personalized Feed Ranking

Inspired by X's recommendation algorithm: personal interest profiling, source affinity tracking, composite scoring, and category-aware diversity. Exposed in a "Personalization" panel at the bottom of the Quality Filter view.

**Interest profile (`quality.js`):** `computeInterestProfile()` analyzes `allPapers` against user engagement signals (`readPosts`, `savedPosts`, `hiddenPosts`, `paperRatings`) to produce:
- `sourceCounts` — `{ sourceKey: { read, saved, rated, hidden, total } }` per source
- `catCounts` — `{ category: { read, saved, hidden } }` per FEED_CATALOG category
- `topTopics` — top 15 weighted words from read/saved/rated titles (stop words filtered)
- `topCategories` — top 5 categories by engagement score (`read + saved*3 - hidden`)
- Stored in `localStorage.interestProfile`, recomputed if >5 minutes stale. Computed on each `loadAllFeeds()`.

**Source affinity (`quality.js`):** `getSourceAffinity()` derives `{ sourceKey: 0.1–1.0 }` from `sourceCounts`: `engagement = (read + saved*2 + rated*3) / total`, `penalty = hidden / total * 0.5`, `affinity = clamp(engagement - penalty, 0.1, 1.0)`. Sources with <3 total posts default to 0.5.

**Interest context (`quality.js` → `routes/feed.py`):** `buildInterestContext()` returns a string like `"topics=[neural networks, rust, ...], categories=[Research & Science, Programming]"`. Sent as `interest_context` in Phase 2 scoring requests. Server appends it to the scoring prompt and uses a separate `prompt_hash` for caching so personalized scores don't collide with generic ones.

**Composite scoring & "For You" sort (`feed.js`):** A `foryou` sort mode in `getFilteredPapers()`:
```
compositeScore = llmScore * (base + sourceAffinity * affinityWeight) + recencyBoost * recencyWeight
```
- `llmScore` = quality cache score (0-100), default 50 if missing
- `sourceAffinity` = from `getSourceAffinity()`, default 0.5
- `recencyBoost` = `max(0, 10 - ageHours * 0.5)` — decays over 20h, max +10
- All three weights are configurable via sliders in the personalization panel: `fyWeightBase` (default 0.7), `fyWeightAffinity` (default 0.3), `fyWeightRecency` (default 1.0)
- Stored as `p._compositeScore` on each paper. Activated via the sparkles "For You" button in the feed toolbar.

**Category-aware diversity (`feed.js`):** Replaces simple round-robin interleaving. Walks the sorted list and limits same-category runs to `maxPerCategoryRun` (default 3, configurable via slider in the personalization panel, stored in `localStorage.maxPerCategoryRun`). Falls back to taking posts in order if all remaining are the same category.

**Personalization panel (`feed.js`):** `_renderPersonalizationPanel()` renders inside `renderQualityView()` after "Blocked Posts". Shows:
- Top topics and categories as chips
- Source engagement table (name, read%, saved%, affinity bar), sorted by affinity descending
- Category diversity slider (1–10)
- Composite score weight sliders (base, affinity, recency)
- "Reset personalization" button (resets profile, weights, and diversity setting)
- "Read more posts to build your profile" if <10 read posts

**Key functions:**
- `computeInterestProfile()` / `getInterestProfile()` — compute and retrieve the profile
- `buildInterestContext()` — format profile as string for server
- `getSourceAffinity()` — derive per-source affinity scores
- `resetPersonalization()` — clear and recompute profile
- `_renderPersonalizationPanel()` — render the personalization UI in quality view

### Aether Panel

The aether panel is the unified right-click interaction surface across the app. It opens on right-click (`contextmenu`) anywhere and provides an inline chat input, context-aware actions, and drag-to-screenshot capture.

**Opening:** Right-click anywhere opens the panel at the cursor position. It starts in track mode (`_aetherTrackMode = true`), following the cursor until the user interacts. Left-click dismisses it.

**Context-aware content:** When right-clicking on links or images, the panel shows relevant actions (Open Link, Copy Address, etc.) via `contextData` passed to `_showAetherPanel()`. Otherwise it shows a blank chat input.

**Inline chat:** The panel includes a chat input (`Ask anything…`) that sends messages to `/api/doc-chat` via SSE streaming (Enter). Chat history is maintained in `_popupChatMessages`. Messages can be moved to the sidebar chat via "Open in sidebar". In the paper viewer, the first message includes document context (`_docText`).

**Web search:** Pressing Shift+Enter in the input performs a web search via `/api/web-search`, displaying results inline in the panel.

**Keyboard navigation:** All dropdowns and option lists in the aether panel (command autocomplete, `/tabs`, `/tab`, `/notes`, `/model`, `/history`, `/links`) must be fully keyboard-navigable: Arrow Up/Down to move selection, Enter to confirm, Escape to dismiss. Any new dropdown or option list added to the panel should follow this same pattern.

**Text selection popup:** Selecting text replaces the aether panel with a selection popup showing Quote, Aether (single words), and highlight color dots (in PDF). The selection popup also has an inline chat input.

**Drag-to-screenshot (Electron only):** While the aether panel is open and tracking the cursor, left-click-dragging captures a screenshot of the dragged region. The panel pins in place, a dashed selection rectangle with dimmed overlay appears, and on mouseup the region is captured via `electronAPI.captureScreen()` (IPC to `BrowserWindow.capturePage()`). Screenshots appear as thumbnails in an attachment strip above the chat input. When sent, messages with screenshots go to `/api/doc-chat` with `vision: true`, using the `deepseek-ocr` vision model instead of `qwen2.5:3b`.

**Key state variables (in `js/views.js`):**
- `_aetherTrackMode` — whether the panel tracks the cursor
- `_popupChatMessages` — chat message history for the current panel
- `_pendingScreenshots` — base64 PNG strings awaiting send
- `_screenshotDragStart` — tracks active screenshot drag
- `_popupChatAbort` — AbortController for in-flight chat requests

**Key functions:**
- `_showAetherPanel(x, y, contextData)` — creates the panel
- `_sendPopupChatMessage(popup, capturedText)` — sends chat with optional vision support (Enter)
- `_doAetherWebSearch(popup)` — performs web search via `/api/web-search` (Shift+Enter)
- `_renderPopupChat(popup, final)` — renders chat messages, search results, and inline image thumbnails
- `_addScreenshotToPanel(popup, base64)` — adds screenshot thumbnail to attachment strip
- `_handleContextMenuChat(e)` — right-click handler that opens the panel

**Electron IPC (`electron/main.js` + `electron/preload.js`):**
- `ipcMain.handle('capture-screen', ...)` — captures a rectangular region of the window
- `electronAPI.captureScreen(rect)` — exposed to renderer via preload

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
- DuckDuckGo (web search): `https://html.duckduckgo.com/html/`
- Polymarket: `https://polymarket.com/breaking` (scraped for breaking markets)

### Database Schema (SQLite — `aether.db`)

Auto-created on first run. 24 tables:

**Auth & Users:** `users` (google_id PK, email, name, username, picture, profile_private, last_seen, status), `sessions` (token PK, google_id, expires 30-day TTL), `user_data` (google_id + key composite PK, per-user settings sync)

**Teams:** `teams`, `team_members`, `team_invites`, `experiment_teams`

**Content:** `experiment_owners`, `calendar_events`, `todos` (with experiment_id and paper_link), `comments` (paper comments with threading)

**Messaging:** `direct_messages`, `team_messages`, `team_todos`, `team_chat_read`

**Social:** `message_reactions`, `reposts`, `blog_votes`, `achievements`

**Caching:** `reference_cache` (paper references), `author_cache` (author info), `quality_cache` (AI filter verdicts/scores)

**Feeds:** `feed_items` (source, title, link, authors, categories, description, pub_date, display_date, arxiv_id, extra, fetched_at — indexed on source, unique on source+link)

**Analytics:** `usage_log` (event, timestamp)

### localStorage Keys

| Key | Purpose |
|-----|---------|
| **Auth** | |
| `authToken` | Session bearer token |
| `authUser` | Authenticated user email/name |
| `authUserInfo` | Full user info object |
| **Feed & Quality** | |
| `feedSources` | `{ key: boolean }` — which catalog feeds are enabled |
| `customFeeds` | Array of `{ url, name, enabled }` for user-added RSS feeds |
| `qualityFilter` | `'on'` or `'off'` — AI filter toggle state |
| `qualityPrompt` | Custom verdict prompt (if different from default) |
| `qualityThreshold` | `0-10` integer — minimum score to display |
| `qualityCache` | `{ title: { v: 'keep'\|'skip', s: number\|null } }` — cached verdicts and scores |
| `qualityBypass` | Bypass rules for quality filter |
| `qualityTestTitles` | Array of strings — titles that must be classified as SKIP |
| `hiddenPosts` | Array of post URLs permanently hidden by user |
| `savedPosts` | `{ url: { paper, savedAt, read } }` — reading list |
| `readPosts` | Array of post URLs that have been clicked/opened |
| `paperRatings` | Per-paper rating data |
| `blockedWords` | Blocked word list for feed filtering |
| `seenPostLinks` | Set of seen post URLs |
| `repostedLinks` | Reposted link URLs |
| `offlineCached` | Offline cached posts |
| `userQuotes` | User-saved quotes |
| `searchHistory` | Feed search history |
| **Personalization** | |
| `interestProfile` | `{ sourceCounts, catCounts, topTopics, topCategories, updatedAt }` |
| `maxPerCategoryRun` | `1-10` integer — diversity mixing parameter (default 3) |
| `fyWeightBase` | `0.0-1.0` float — base weight in composite score (default 0.7) |
| `fyWeightAffinity` | `0.0-1.0` float — affinity multiplier (default 0.3) |
| `fyWeightRecency` | `0.0-2.0` float — recency boost multiplier (default 1.0) |
| **Appearance** | |
| `theme` | dark/light/auto |
| `accentColor` | Accent color hex |
| `aetherColor` | Aether panel color |
| `spinner` | Loading animation style |
| `editorTheme` | Code editor theme |
| `pixelPet` | Pet on/off |
| `pixelPetType` | Pet type (cat, froog, etc.) |
| `pixelPetMode` | Pet behavior mode |
| **UI State** | |
| `userName` | User display name |
| `sidebarOrder` | Sidebar button order |
| `sidebarTab` | Active sidebar tab |
| `lastHash` | Last hash route |
| `universalPanelVisible` | Right panel visibility |
| `universalPanelWidth` | Right panel width |
| `paperSidebarWidth` | Paper sidebar width |
| `expSidebarWidth` | Experiment sidebar width |
| `expSidebarCollapsed` | Experiment sidebar collapsed |
| `teamSidebarCollapsed` | Team sidebar collapsed |
| `dismissedInboxTasks` | Dismissed inbox task IDs |
| `downloadBannerDismissed` | Banner dismissal state |
| **Sound** | |
| `clickSound` | Click sound on/off |
| `clickSoundType` | Click sound type |
| `clickAether` | Aether click interaction on/off |
| `rainOn` | Ambient noise on/off |
| `rainVolume` | Ambient noise volume |
| `rainNoiseType` | Ambient noise type |
| `rainSidebarVisible` | Rain sidebar visibility |
| **Browse** | |
| `browseHistory` | Browse history |
| `browseClosedTabs` | Closed tab stack for reopen |
| `browseDownloads` | Download history |
| `browseDownloadsLastSeen` | Last seen download count |
| `browseBarOrder` | Browse bar button order |
| `browseBarOverflow` | Overflow menu items |
| `browseTabSessions` | Saved tab sessions |
| `webSearchHistory` | Web search history |
| `adBlockEnabled` | Ad blocker on/off |
| `sitePermissions` | Per-site permissions |
| `aetherPanelSide` | Left/right panel preference |
| **Chat** | |
| `chatModel` | Selected chat model |
| `chatThreads` | Document chat threads |
| `chatTools` | Chat tools on/off |
| **Insights** | |
| `insightsAllowHeuristics` | Allow heuristic insights |
| `insightSubtab` | Active insight subtab |
| **Notifications** | |
| `feedNotifications` | Feed notification array |
| `feedNotifSources` | Notification settings per source |
| **PDF** | |
| `pdfHighlights` | PDF highlight annotations |
| `pdfDrawings` | PDF pen drawings |
| **Other** | |
| `terminalState` | Terminal state persistence |
| `vaultLastNote` | Last opened note ID |
| `vaultWelcomeCreated` | Welcome note creation flag |
| `whiteboardBoards` | Board list |
| `whiteboardLastId` | Last active board ID |

### Authentication & User Accounts

Users must sign in before accessing the app. A full-screen login gate blocks all content until authenticated.

**Backend (SQLite):** User data lives in `aether.db` with:
- `users` — google_id (primary key), email, name, username (unique), picture, created, profile_private, last_seen, status_emoji, status_text
- `sessions` — token (primary key), google_id (FK), expires (30-day TTL)
- `user_data` — per-user key-value store for synced settings (google_id + key composite PK)

**Auth endpoints:**
- `POST /api/auth/register` — create account, returns session token
- `POST /api/auth/login` — verify credentials, returns session token
- `POST /api/auth/logout` — delete session (requires `Authorization: Bearer <token>`)
- `GET /api/auth/me` — validate session, returns user info
- `POST /api/sync` — bidirectional settings sync (last-write-wins by timestamp per key)

**Frontend flow:**
1. On page load, `core.js` checks for a stored `authToken` in localStorage
2. If no token or token is expired → show login gate (covers entire app)
3. On successful login → pull settings from server, hide gate, start 60s sync interval
4. On register → push current localStorage defaults to server as initial settings
5. Account button in sidebar opens a modal to sync or sign out

**Synced settings (`SYNC_KEYS`):** feedSources, customFeeds, qualityFilter, qualityPrompt, qualityThreshold, qualityCache, hiddenPosts, savedPosts, readPosts, qualityTestTitles, paperRatings, theme, accentColor, spinner, userName, sidebarOrder, clickSound, clickSoundType, rainNoiseType, rainVolume, editorTheme, rainSidebarVisible, pixelPet, pixelPetType, pixelPetMode, feedNotifications, seenPostLinks, adBlockEnabled, feedNotifSources, browseBarOrder, browseHistory, webSearchHistory, chatThreads, aetherColor, interestProfile

## Key Conventions

- UI uses a dark theme (and light theme) with accent color `#b4451a`
- Tailwind CSS loaded via CDN (`https://cdn.tailwindcss.com`) with custom theme colors mapped to CSS variables
- No frameworks, bundlers, or package managers — all vanilla
- No tests or linting configured; use `node -c file.js` to check syntax
- Experiment slugs are generated via `slugify()` in `persistence.py`
- All feed-related rendering is data-driven from `FEED_CATALOG`
- `getSourceChip(source, arxivId)` resolves any source key to its inline logo + name
- `catalogLogo(entry, size)` generates SVG/img logos (supports 'onboard', 'inline', or card sizes)
- Quality filter prompts are defined as constants in `persistence.py` (`DEFAULT_VERDICT_PROMPT`, `DEFAULT_SCORING_PROMPT`) and mirrored in `js/quality.js` (`DEFAULT_QUALITY_PROMPT`)
- Feed catalog must be kept in sync between `js/core.js` (frontend) and `feed_catalog.py` (backend)
