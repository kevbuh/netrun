# CLAUDE.md

## Running the Application

```bash
brew services start ollama                # optional: AI quality filter + semantic search
ollama pull qwen2.5:1.5b                  # quality filter model
ollama pull nomic-embed-text              # semantic search (~274MB)
npm start                                 # Electron app (spawns Flask server)
npm run server                            # Flask server only
npm test                                  # node:test runner
```

## Architecture

Vanilla JS frontend, Flask backend, Electron shell. Desktop app — memory efficiency matters (user runs local LLMs alongside). No frameworks, bundlers, or modules — all functions are global.

### Backend — `src/`

Flask server (`app.py`) with route blueprints in `src/routes/`:
- `auth.py` (6) — login, logout, username, delete, me, sync
- `feed.py` (14) — feeds, RSS proxy, quality filter, models, feed-items
- `experiments.py` (29) — experiment CRUD, files, runs, kernel, venv, execute (SSE)
- `social.py` (51) — teams, users, messages, comments, blog, achievements
- `content.py` (14) — doc-chat (SSE), extract-text/links, paper-insights, citations, author/reference lookups, panel/search suggest
- `browse.py` (8) — web-search, browse-proxy, image-proxy, link-preview, stock-quote, adblock
- `vault.py` (11) — notes CRUD, marimo start/stop, vault path/tree
- `misc.py` (31) — neuralook (SSE + calibration + training + predict + implicit-samples + refine), transcribe, vibe/git, todos, calendar, images, saved-content

Helper modules: `helpers.py` (auth, SSE, chat tools, arxiv), `vault_helpers.py` (vault I/O, git ops), `persistence.py` (25-table DB, prompts, classify_title, cached_fetch), `kernels.py` (Jupyter kernel mgmt), `feed_catalog.py` (server mirror of FEED_CATALOG — must stay in sync with `js/core.js`), `feed_parser.py` (RSS/Atom/HN/Polymarket, stdlib only), `feed_poller.py` (10min polling daemon, 8 threads, 30-day retention)

**Key API groups:**
- **Feeds:** `/feed`, `/hn-feed`, `/polymarket-feed`, `/api/feed-items`, `/api/feed-items/custom`, `/api/rss-proxy?url=`, `/api/arxiv-search`, `/api/citations`
- **Quality:** `/api/quality-filter` (POST, verdict KEEP/SKIP or score 0-100, optional `interest_context`), `/api/quality-prompt` (GET/PUT), `/api/blocked-titles` (GET/POST/DELETE)
- **Content:** `/api/doc-chat` (SSE, optional `vision:true`), `/api/extract-text`, `/api/extract-links`, `/api/paper-insights`, `/api/author-details`, `/api/citation-lookup`, `/api/paper-references`, `/api/author-lookup`, `/api/panel-suggest`, `/api/search-suggest`
- **Embeddings:** `/api/embed-content` (fire-and-forget), `/api/semantic-search`, `/api/find-similar`
- **Browse:** `/api/web-search?q=`, `/api/check-embed`, `/api/images`
- **Experiments:** `/api/experiments` (CRUD, stored as `experiments/{slug}/meta.json`)
- **Neuralook:** `/api/neuralook/save-calibration`, `/api/neuralook/train` (SSE), `/api/neuralook/predict`, `/api/neuralook/implicit-samples`, `/api/neuralook/refine-history`, `/api/neuralook/auto-refine`

Server-side files: `quality_prompt.txt` (custom verdict prompt), `blocked_titles.json` (prompt test suite)

### Frontend — `src/index.html` + `js/` + `styles.css`

26 JS files, 16 HTML templates in `views/` (lazy-loaded via `VIEW_REGISTRY`). Hash routing:

| Route | View |
|-------|------|
| `#` | Onboarding (first visit) |
| `#feed` | Multi-source feed (masonry, sorting, trends, infinite scroll) |
| `#saved` | Dashboard (heatmap, reading list, experiments, quotes) |
| `#research` | Browse with blank tab + search tabs |
| `#view/`, `#paper/` | Paper viewer (PDF or iframe + sidebar) |
| `#browse` | Built-in browser (tabs, URL bar, ad blocker) |
| `#experiment/{id}` | Experiment detail (editors, kernel, venv) |
| `#calendar` | Calendar (month grid, event CRUD) |
| `#vault` | Notes, vibe coding, marimo |
| `#teams`, `#team/{id}` | Team collaboration |
| `#inbox` | Unified inbox |
| `#terminal` | WebSocket terminal |
| `#neuralook` | Eye-tracking |
| `#settings` | Settings (themes, feeds, quality, AI models) |
| `#quality`, `#algorithm` | Redirect to Settings sub-tabs |
| `#blog/{id}`, `#profile/{username}`, `#author/{id}`, `#dev` | Content views |
| `#vibe`, `#experiments`, `#search` | Legacy redirects → vault/research |

**Script load order** (order matters — all global): `core.js` → `pixel-pet.js` → `feed.js` → `quality.js` → `settings.js` → `dashboard.js` → `views.js` → `paper-sidebar.js` → `chat-threads.js` → `panel.js` → `browse-tabs.js` → `browse-urlbar.js` → `search.js` → `calendar.js` → `whiteboard.js` → `pdfviewer.js` → `teams.js` → `experiments.js` → `editors.js` → `notebook-editor.js` → `draw-editor.js` → `slides-editor.js` → `terminal.js` → `vault.js` → `vibe.js` → `neuralook.js`

**Electron:** `electron/main.js` (main process, IPC, Python server lifecycle), `electron/preload.js` (context bridge), `electron/password-store.js` (encrypted passwords via safeStorage). Tests: `tests/password-store.test.js` (node:test + node:assert).

### Window Manager & Sidebar

`wmOpen(key)` in `core.js` manages tiling/fullscreen views. State: `_wmWindows` (open windows), `_wmMode` ('fullscreen'|'tiling'), `_wmViewMeta` (view configs). Tiling mode (`Cmd+T`) shows overlay with `html2canvas` previews.

Left sidebar (60px) has view buttons; order customizable via `localStorage.sidebarOrder`. Keyboard navigable.

### Feed System

`FEED_CATALOG` in `core.js` (mirrored in `feed_catalog.py`) defines 166 sources across 14 categories. Each entry: `key`, `name`, `desc`, `cat`, `url` (or null for special), `special` ('arxiv'|'hn'|'polymarket'), logo props.

**Adding a feed:** append to both `FEED_CATALOG` in `js/core.js` and `CATALOG` in `feed_catalog.py`. Everything else (onboarding, settings, loading, chips, polling) derives from them.

Categories: Research & Science (7), Tech & News (6), Programming (10), AI & ML (4), Security (1), Ideas & Culture (5), Sports (3), Prediction Markets (1), Design (2), Finance (3), Space (2), News & World (4), Blogs & Newsletters (35), HN Top Blogs (83). Users can also add custom RSS feeds.

Source selection: `localStorage.feedSources` as `{ key: boolean }`. Server-side polling via `feed_poller.py` stores items in `feed_items` table; frontend fetches via `/api/feed-items`.

### AI Quality Filter

Two-phase pipeline via local Ollama (`qwen2.5:1.5b`), accessible at Settings > Feed > Quality:

1. **Verdict** — KEEP/SKIP per title using configurable prompt (`DEFAULT_VERDICT_PROMPT`). Editable, saved as `quality_prompt.txt`.
2. **Scoring** — 0-100 relevance via `DEFAULT_SCORING_PROMPT` (read-only). Threshold slider (default 30). Personalization appends `interest_context` to boost relevant content.

`qualityFilterPapers()` runs after feed load with concurrency guard (`_qfRunning`/`_qfQueued`). Inline "Evaluating N…" indicator. Cache in `localStorage.qualityCache` as `{ title: { v, s } }`.

**Prompt test suite:** Hidden posts (✕) go to `qualityTestTitles` (synced to `blocked_titles.json`). "Save prompt" runs test first — blocks save if any title passes.

### Personalized Feed Ranking

`computeInterestProfile()` in `quality.js` analyzes engagement signals (read/saved/hidden/rated posts) to produce `sourceCounts`, `catCounts`, `topTopics` (15), `topCategories` (5). Stored in `localStorage.interestProfile`, recomputed if >5min stale.

`getSourceAffinity()` → `{ sourceKey: 0.1–1.0 }`. `buildInterestContext()` → string sent as `interest_context` to server scoring.

**"For You" sort:** `compositeScore = llmScore * (base + sourceAffinity * affinityWeight) + recencyBoost * recencyWeight`. Weights configurable via sliders: `fyWeightBase` (0.7), `fyWeightAffinity` (0.3), `fyWeightRecency` (1.0).

**Diversity:** `maxPerCategoryRun` (default 3) limits same-category consecutive runs.

**Personalization panel** in quality view: topic/category chips, source engagement table, diversity slider, weight sliders, reset button.

### Dynamic Island

`#pill-island` in the pill bar shows live activity status. Morphs from 0→180px (spring easing), expands to 300px on hover with crossfade. Activities auto-dismiss after 2.5s when `done: true`.

Priority order: `download` (progress ring) > `qf` (filtering/scoring count) > `feed` (loading indicator).

API: `islandUpdate(id, data)`, `islandRemove(id)`, `_islandRender()`. Wired from `quality.js`, `browse-tabs.js`, `feed.js`.

### Aether Panel

Right-click interaction surface. Opens at cursor in track mode (`_aetherTrackMode`), follows cursor until interaction. Left-click dismisses.

Features: context-aware actions (links/images), inline chat (Enter → `/api/doc-chat` SSE), web search (Shift+Enter → `/api/web-search`), slash commands with keyboard-navigable dropdowns (Arrow/Enter/Escape).

**Text selection:** replaces panel with Quote/Aether/highlight popup.

**Drag-to-screenshot (Electron):** left-click-drag while panel tracks → `electronAPI.captureScreen()` → thumbnail attachment → sent with `vision: true`.

Key state: `_aetherTrackMode`, `_popupChatMessages`, `_pendingScreenshots`, `_popupChatAbort` (in `views.js`).
Key functions: `_showAetherPanel()`, `_sendPopupChatMessage()`, `_doAetherWebSearch()`, `_renderPopupChat()`, `_handleContextMenuChat()`.

### Post Actions

- **Bookmark** → `localStorage.savedPosts`
- **Hide (✕)** → `localStorage.hiddenPosts` + `qualityTestTitles`
- **Click** → `localStorage.readPosts` (50% opacity + muted title)

### Semantic Search

`nomic-embed-text` (768-dim) via Ollama. Posts embedded on read/bookmark (`_embedPost()` → `POST /api/embed-content`), vault notes on save. Stored as float32 BLOBs in `embeddings` table, deduped by SHA-256.

- `~query` prefix in search → `/api/semantic-search` (cosine similarity)
- "Find similar" in card menu → `/api/find-similar`
- `_renderSemanticResults()` shows results with source chip + similarity %

### Neuralook (Eye Tracking)

Webcam gaze prediction with dual-model support (CNN/MobileNet). Calibration → training (SSE, hot-swap best weights) → real-time prediction. Continuous passive learning via implicit samples + auto-refine (5min cooldown, adaptive 500px radius).

State in `neuralook.js`: `_nlModelType`, `_nlModelState`, `_nlAutoRefineEnabled`, `_nlRefinementHistory`, `_nlAdaptiveRadius`.

### Database Schema (SQLite — `aether.db`)

25 tables, auto-created:
- **Auth:** `users`, `sessions` (30-day TTL), `user_data` (per-user key-value sync)
- **Teams:** `teams`, `team_members`, `team_invites`, `experiment_teams`
- **Content:** `experiment_owners`, `calendar_events`, `todos`, `comments` (threaded)
- **Messaging:** `direct_messages`, `team_messages`, `team_todos`, `team_chat_read`
- **Social:** `message_reactions`, `reposts`, `blog_votes`, `achievements`
- **Caching:** `reference_cache`, `author_cache`, `quality_cache`
- **Feeds:** `feed_items` (indexed on source, unique on source+link)
- **Embeddings:** `embeddings` (content_hash PK, BLOB, indexed on content_type)
- **Analytics:** `usage_log`

### localStorage Keys (90+)

**Auth:** `authToken`, `authUser`, `authUserInfo`
**Feed & Quality:** `feedSources`, `customFeeds`, `qualityFilter`, `qualityPrompt`, `qualityThreshold`, `qualityCache`, `qualityBypass`, `qualityTestTitles`, `hiddenPosts`, `savedPosts`, `readPosts`, `paperRatings`, `blockedWords`, `seenPostLinks`, `repostedLinks`, `offlineCached`, `userQuotes`, `searchHistory`
**Personalization:** `interestProfile`, `maxPerCategoryRun`, `fyWeightBase`, `fyWeightAffinity`, `fyWeightRecency`
**Appearance:** `theme`, `accentColor`, `aetherColor`, `spinner`, `editorTheme`, `iconSize`, `pixelPet`, `pixelPetType`, `pixelPetMode`
**UI State:** `userName`, `sidebarOrder`, `sidebarTab`, `lastHash`, `universalPanelVisible/Width`, `paperSidebarWidth`, `expSidebarWidth/Collapsed`, `teamSidebarCollapsed`, `dismissedInboxTasks`, `downloadBannerDismissed`
**Sound:** `clickSound`, `clickSoundType`, `clickAether`, `rainOn`, `rainVolume`, `rainNoiseType`, `rainSidebarVisible`
**Browse:** `browseHistory`, `browseClosedTabs`, `browseDownloads`, `browseDownloadsLastSeen`, `browseBarOrder/Overflow`, `browseTabLayout/Sessions`, `vtabsPanelCollapsed`, `urlBarSections`, `webSearchHistory`, `adBlockEnabled`, `sitePermissions`, `aetherPanelSide`
**Chat & AI:** `chatModel`, `visionModel`, `summaryModel`, `chatThreads`, `chatTools`, `panelTabComplete`, `panelSemanticSearch/Min`, `vaultChatMinSimilarity`, `vaultChatMessages`
**Other:** `insightsAllowHeuristics`, `insightSubtab`, `feedNotifications`, `feedNotifSources`, `pdfHighlights`, `pdfDrawings`, `nlRefinementHistory`, `daySummaryCache`, `terminalState`, `vaultLastNote`, `vaultWelcomeCreated`, `whiteboardBoards/LastId`

### Authentication

Login gate blocks app until authenticated. Auth endpoints: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/sync` (bidirectional, last-write-wins per key).

Flow: check `authToken` → show gate if missing/expired → on login pull settings + start 60s sync → on register push defaults.

**Synced settings (52 keys):** feedSources, customFeeds, qualityFilter, qualityPrompt, qualityThreshold, qualityCache, hiddenPosts, savedPosts, readPosts, qualityTestTitles, paperRatings, theme, accentColor, spinner, userName, sidebarOrder, clickSound, clickSoundType, clickAether, rainNoiseType, rainVolume, editorTheme, rainSidebarVisible, pixelPet, pixelPetType, pixelPetMode, feedNotifications, seenPostLinks, adBlockEnabled, feedNotifSources, browseBarOrder, browseHistory, webSearchHistory, chatThreads, aetherColor, interestProfile, urlBarSections, blockedWords, qualityBypass, searchHistory, userQuotes, repostedLinks, fyWeightBase, fyWeightAffinity, fyWeightRecency, maxPerCategoryRun, pdfHighlights, pdfDrawings, chatModel, chatTools, insightsAllowHeuristics, iconSize

### External APIs

arXiv (RSS + API), Hacker News, Semantic Scholar, Ollama (`localhost:11434`), DuckDuckGo, Polymarket

## Key Conventions

- Dark/light themes, accent `#b4451a`, Tailwind via CDN
- No frameworks/bundlers — all vanilla JS
- Tests: `npm test` (node:test + node:assert). Syntax check: `node -c file.js`
- Feed rendering is data-driven from `FEED_CATALOG`; catalog must stay in sync between `js/core.js` and `feed_catalog.py`
- `getSourceChip(source, arxivId)` → inline logo + name; `catalogLogo(entry, size)` → SVG/img logos
- Quality prompts: `DEFAULT_VERDICT_PROMPT` / `DEFAULT_SCORING_PROMPT` in `persistence.py`, mirrored in `quality.js`
