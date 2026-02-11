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
- `social.py` (52) — teams, users, messages, comments, blog, achievements
- `content.py` (16) — doc-chat (SSE), extract-text/links, citations, author/reference lookups, panel/search suggest, annotate, knowledge-graph, chat-memories
- `browse.py` (6) — web-search, browse-proxy, image-proxy, link-preview, stock-quote, check-embed
- `vault.py` (11) — notes CRUD, marimo start/stop, vault path/tree
- `misc.py` (31) — neuralook (SSE + calibration + training + predict + implicit-samples + refine), transcribe, vibe/git, todos, calendar, images, saved-content, function-registry, dev-stats

Helper modules: `helpers.py` (auth, SSE, chat tools, arxiv), `vault_helpers.py` (vault I/O, git ops), `persistence.py` (25-table DB, prompts, classify_title, cached_fetch), `kernels.py` (Jupyter kernel mgmt), `feed_catalog.py` (server mirror of FEED_CATALOG — **manually kept in sync** with `js/core.js`), `feed_parser.py` (RSS/Atom/HN/Polymarket, stdlib only), `feed_poller.py` (10min polling daemon, 8 threads, 30-day retention), `terminal_server.py` (WebSocket terminal)

**Key API groups:**
- **Feeds:** `/feed`, `/hn-feed`, `/polymarket-feed`, `/api/feed-items`, `/api/feed-items/custom`, `/api/rss-proxy?url=`, `/api/arxiv-search`, `/api/citations`
- **Quality:** `/api/quality-filter` (POST, verdict KEEP/SKIP or score 0-100, optional `interest_context`), `/api/quality-prompt` (GET/PUT), `/api/blocked-titles` (GET/POST/DELETE)
- **Content:** `/api/doc-chat` (SSE, optional `vision:true`), `/api/extract-text`, `/api/extract-links`, `/api/author-details`, `/api/citation-lookup`, `/api/paper-references`, `/api/author-lookup`, `/api/panel-suggest`, `/api/search-suggest`, `/api/annotate`, `/api/knowledge-graph/similarities`
- **Memories:** `/api/chat-memory` (POST, fire-and-forget save), `/api/chat-memories` (GET, semantic search), `/api/chat-memories/list`, `/api/chat-memories/<id>` (DELETE), `/api/chat-memories/stats`
- **Embeddings:** `/api/embed-content` (fire-and-forget), `/api/semantic-search`, `/api/find-similar`
- **Browse:** `/api/web-search?q=`, `/api/check-embed`, `/api/browse-proxy`, `/api/image-proxy`, `/api/link-preview`, `/api/stock-quote`
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
| `#browse` | Built-in browser (tabs, URL bar, ad blocker) |
| `#experiment/{id}` | Experiment detail (editors, kernel, venv) |
| `#calendar` | Calendar (month grid, event CRUD) |
| `#vault` | Notes, vibe coding, marimo |
| `#teams`, `#team/{id}` | Team collaboration |
| `#inbox` | Unified inbox |
| `#terminal` | WebSocket terminal |
| `#neuralook` | Eye-tracking |
| `#graph` | Knowledge graph (force-directed visualization) |
| `#settings` | Settings (themes, feeds, quality, AI models) |
| `#quality`, `#algorithm` | Redirect to Settings sub-tabs |
| `#blog/{id}`, `#profile/{username}`, `#author/{id}`, `#dev` | Content views |
| `#vibe`, `#experiments`, `#search` | Legacy redirects → vault/research |

**Script load order** (order matters — all global): `core.js` → `motion.js` → `pixel-pet.js` → `feed.js` → `quality.js` → `settings.js` → `dashboard.js` → `views.js` → `chat-threads.js` → `panel.js` → `browse-tabs.js` → `browse-urlbar.js` → `search.js` → `calendar.js` → `whiteboard.js` → `teams.js` → `experiments.js` → `editors.js` → `notebook-editor.js` → `draw-editor.js` → `slides-editor.js` → `terminal.js` → `vault.js` → `knowledge-graph.js` → `vibe.js` → `neuralook.js`

**Electron:** `electron/main.js` (main process, IPC, Python server lifecycle), `electron/preload.js` (context bridge), `electron/password-store.js` (encrypted passwords via safeStorage). Tests: `tests/password-store.test.js` (node:test + node:assert).

### Window Manager & Sidebar

`wmOpen(key)` in `core.js` manages tiling/fullscreen views. State: `_wmWindows` (open windows), `_wmMode` ('fullscreen'|'tiling'), `_wmViewMeta` (view configs). Tiling mode (`Cmd+T`) shows overlay with `html2canvas` previews.

Left sidebar (60px) has view buttons; order customizable via `localStorage.sidebarOrder`. Keyboard navigable.

### Feed System

`FEED_CATALOG` in `core.js` (mirrored in `feed_catalog.py`) defines 166 sources across 14 categories. Each entry: `key`, `name`, `desc`, `cat`, `url` (or null for special), `special` ('arxiv'|'hn'|'polymarket'), logo props.

**Adding a feed:** append to both `FEED_CATALOG` in `js/core.js` and `CATALOG` in `feed_catalog.py` (must manually sync both). Everything else (onboarding, settings, loading, chips, polling) derives from them.

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

Priority order: `achievement` > `download` (progress ring) > `tts`/`ai`/`cc` > `annotate` > `bookmark`/`rss`/`audio`/`qf` > `feed` > `context`.

Pill types: `download` (progress ring), `tts` (waveform), `audio` (animated bars), `ai` (pulsing dot), `achievement` (trophy), `rss` (subscribe), `tabs` (browse tabs), `annotate` (pen), `bookmark` (filled bookmark icon, accent color, auto-dismiss), `context` (generic).

**Bookmark pill:** Fires on save via `toggleSavePost()` (feed.js) and `browseSaveToReadingList()` (browse-tabs.js). Shows "Saved" with truncated title on hover. Flying bookmark icon animates to pill island. Auto-dismisses after 2.5s.

API: `islandUpdate(id, data)`, `islandRemove(id)`, `_islandRender()`. Wired from `quality.js`, `browse-tabs.js`, `feed.js`, `panel.js`, `vault.js`, `neuralook.js`, `dashboard.js`, `search.js`.

### Aether Panel

Right-click interaction surface. Opens at cursor in track mode (`_aetherTrackMode`), follows cursor until interaction. Left-click dismisses.

Features: context-aware actions (links/images), inline chat (Enter → `/api/doc-chat` SSE), web search (Shift+Enter → `/api/web-search`), slash commands with keyboard-navigable dropdowns (Arrow/Enter/Escape).

**Text selection:** replaces panel with Quote/Aether popup.

**Drag-to-screenshot (Electron):** left-click-drag while panel tracks → `electronAPI.captureScreen()` → thumbnail attachment → sent with `vision: true`.

Key state: `_aetherTrackMode`, `_popupChatMessages`, `_pendingScreenshots`, `_popupChatAbort` (in `views.js`).
Key functions: `_showAetherPanel()`, `_sendPopupChatMessage()`, `_doAetherWebSearch()`, `_renderPopupChat()`, `_handleContextMenuChat()`.

### Post Actions

- **Bookmark** → `localStorage.savedPosts` + Dynamic Island pill + flying icon animation
- **Hide (✕)** → `localStorage.hiddenPosts` + `qualityTestTitles`
- **Click** → `localStorage.readPosts` (50% opacity + muted title)

### Ad Blocking

Two-layer system in `electron/main.js` + `browse-tabs.js`, gated on `localStorage.adBlockEnabled`.

**Network-level** (Electron `onBeforeRequest`): adblock-rs engine (EasyList + EasyPrivacy) blocks ad/tracker requests. YouTube-specific URL patterns (`/api/stats/ads`, `/pagead/`, `/get_midroll_`, `doubleclick.net`, `googlesyndication.com`) checked first for fast-path blocking.

**Cosmetic** (element hiding + removal): `adblock-cosmetic` IPC returns EasyList cosmetic selectors per URL. CSS injected via `frame.insertCSS()` on `dom-ready` + `did-navigate`; elements removed from DOM via `MutationObserver` (30s TTL).

**YouTube-specific** (`_browseInjectYouTubeAdBlock`, `_browseInjectYouTubeCSS`): CSS injected on `did-navigate` (pre-paint) hides `.ad-showing` video + ad containers. Early mute script intercepts `HTMLMediaElement.prototype.play()` to silence ads before audio plays. Polling loop (300ms) fast-forwards ads at 16x speed, clicks skip buttons, tries player API (`skipAd`, `cancelPlayback`). `MutationObserver` auto-dismisses ad-blocker enforcement dialogs. Guard flag `window.__aetherYtAdBlockInjected` prevents double-injection.

Key globals: `_ytAdBlockCSS` (shared CSS string), `_browseInjectYouTubeCSS(frame, url)` (early CSS+mute), `_browseInjectYouTubeAdBlock(frame, url)` (full JS skipper on dom-ready).

### AetherMotion

`js/motion.js` — lightweight animation framework exposing a global `Motion` object. Opt-in; existing CSS animations stay untouched.

**Design tokens:** `Motion.spring.snappy/smooth/gentle/bouncy` (tension/friction/mass), `Motion.duration.instant/fast/normal/slow`, `Motion.stagger.tight/normal/relaxed`. `Motion.css('snappy')` returns the `cubic-bezier(0.34, 1.56, 0.64, 1)` used throughout the codebase.

**Core:** `Motion.animate(el, { spring, from, to, duration, delay, onFinish })` — Web Animations API, auto GPU promote/demote, interruptible (cancels previous on same element). Shorthand transform props: `x`, `y`, `scale`, `rotate`. Spring keyframes generated via damped harmonic oscillator (cached, 64 entries).

**Helpers:** `Motion.fadeIn(el, {y, delay})` / `Motion.fadeOut(el, {y, remove})` for common opacity+slide. `Motion.flash(el, holdMs)` for save indicators. `Motion.toast(text, {position, duration})` creates/animates/removes toast elements. `Motion.sequence([steps])` chains animations, `Motion.staggerFn(selector, config)` staggers across elements, `Motion.flip(el, callback)` for FLIP layout animations.

**CSS tokens:** Auto-injected on load as custom properties: `--motion-snappy`, `--motion-smooth`, `--motion-gentle`, `--motion-bouncy`, `--motion-ease-out`, `--motion-instant/fast/normal/slow`. All 27 spring easing references in `styles.css` use `var(--motion-snappy)` etc. — single source of truth.

**GPU management:** `Motion.promote(el)` / `Motion.demote(el)`, budget of 30 layers (8 when Ollama active). Auto-demote after animation ends.

**Ollama awareness:** Polls `localhost:11434/api/ps` every 5s. `Motion.modelActive` (boolean), `Motion.reducedMotion` (modelActive OR `prefers-reduced-motion`). Reduces layer budget and collapses animation duration when active.

### Semantic Search

`nomic-embed-text` (768-dim) via Ollama. Posts embedded on read/bookmark (`_embedPost()` → `POST /api/embed-content`), vault notes on save. Stored as float32 BLOBs in `embeddings` table, deduped by SHA-256.

- `~query` prefix in search → `/api/semantic-search` (cosine similarity)
- "Find similar" in card menu → `/api/find-similar`
- `_renderSemanticResults()` shows results with source chip + similarity %

### Neuralook (Eye Tracking)

Webcam gaze prediction with dual-model support (CNN/MobileNet). Calibration → training (SSE, hot-swap best weights) → real-time prediction. Continuous passive learning via implicit samples + auto-refine (5min cooldown, adaptive 500px radius).

State in `neuralook.js`: `_nlModelType`, `_nlModelState`, `_nlAutoRefineEnabled`, `_nlRefinementHistory`, `_nlAdaptiveRadius`.

### Conversational Memory

Chat conversations are automatically summarized and embedded for future recall. Backend uses Ollama (`qwen2.5:1.5b`) to extract summary + topics, then embeds with `nomic-embed-text` into `chat_memories` table.

**Flow:**
- **Save:** On chat close, `_saveChatMemory()` (panel.js) POSTs to `/api/chat-memory` → background thread summarizes + embeds → stored in SQLite
- **Retrieve:** On first message of new chat, semantic search via `/api/chat-memories?query=...` → relevant memories injected into context as `RELEVANT PAST CONVERSATIONS:`
- **UI:** Settings > Memory shows list of memories with topics, stats, delete/clear actions
- **Cross-feature wiring:** Memory topics feed into interest profile (`computeInterestProfile()` in quality.js with weight 2), memory nodes appear in knowledge graph (purple, connected to papers/topics)

Persistence: `list_chat_memories()`, `delete_chat_memory()`, `get_memory_stats()` in `persistence.py`. 5-min cache aligned with interest profile.

### Knowledge Graph

Force-directed canvas visualization of papers, authors, topics, notes, and memories. Nodes connected by similarity edges (via `/api/knowledge-graph/similarities`). View at `#graph`, implemented in `knowledge-graph.js` with `knowledge-graph.html` template.

**Node types:** paper (accent color), author (blue), topic (green diamond), note (orange square), memory (purple circle). Memories connect to papers via `page_url` (discussed edge) and topics via keyword match (has_topic edge).

### Database Schema (SQLite — `aether.db`)

26 tables, auto-created:
- **Auth:** `users`, `sessions` (30-day TTL), `user_data` (per-user key-value sync)
- **Teams:** `teams`, `team_members`, `team_invites`, `experiment_teams`
- **Content:** `experiment_owners`, `calendar_events`, `todos`, `comments` (threaded)
- **Messaging:** `direct_messages`, `team_messages`, `team_todos`, `team_chat_read`
- **Social:** `message_reactions`, `reposts`, `blog_votes`, `achievements`
- **Caching:** `reference_cache`, `author_cache`, `quality_cache`, `smart_highlights_cache`
- **Feeds:** `feed_items` (indexed on source, unique on source+link)
- **Embeddings:** `embeddings` (content_hash PK, BLOB, indexed on content_type), `chat_memories` (summary, topics, page_url/title, embedding BLOB, created_at)
- **Analytics:** `usage_log`

### localStorage Keys (100+)

**Auth:** `authToken`, `authUser`, `authUserInfo`
**Feed & Quality:** `feedSources`, `customFeeds`, `qualityFilter`, `qualityPrompt`, `qualityThreshold`, `qualityCache`, `qualityBypass`, `qualityTestTitles`, `hiddenPosts`, `savedPosts`, `readPosts`, `paperRatings`, `blockedWords`, `seenPostLinks`, `repostedLinks`, `offlineCached`, `userQuotes`, `searchHistory`
**Personalization:** `interestProfile`, `maxPerCategoryRun`, `fyWeightBase`, `fyWeightAffinity`, `fyWeightRecency`
**Memories:** Chat memory retrieval flag managed per-session
**Appearance:** `theme`, `accentColor`, `aetherColor`, `spinner`, `editorTheme`, `iconSize`, `pixelPet`, `pixelPetType`, `pixelPetMode`
**UI State:** `userName`, `sidebarOrder`, `sidebarTab`, `lastHash`, `universalPanelVisible/Width`, `expSidebarWidth/Collapsed`, `teamSidebarCollapsed`, `dismissedInboxTasks`, `downloadBannerDismissed`, `_browseReturnView`, `_lastActiveView`, `_navHistory`, `_navForward`
**Sound & TTS:** `clickSound`, `clickSoundType`, `clickAether`, `rainOn`, `rainVolume`, `rainNoiseType`, `rainFreq`, `rainSidebarVisible`, `ttsHighlight`, `ttsSpeed`, `voiceAutoSend`
**Browse:** `browseHistory`, `browseClosedTabs`, `browseDownloads`, `browseDownloadsLastSeen`, `browseBarOrder/Overflow`, `browseTabLayout/Sessions`, `urlBarSections`, `webSearchHistory`, `adBlockEnabled`, `sitePermissions`, `aetherPanelSide`
**Chat & AI:** `chatModel`, `visionModel`, `summaryModel`, `chatThreads`, `chatTools`, `chatThinking`, `panelTabComplete`, `panelSemanticSearch/Min`, `vaultChatMinSimilarity`, `vaultChatMessages`
**Annotations:** `smartHighlights`, `annotationsCache`, `autoAnnotate`
**Other:** `insightsAllowHeuristics`, `feedNotifications`, `feedNotifSources`, `nlRefinementHistory`, `daySummaryCache`, `terminalState`, `vaultLastNote`, `vaultWelcomeCreated`, `whiteboardBoards/LastId`, `hiddenSidebarIcons`, `ach_*`, `urlShorten`

### Authentication

Login gate blocks app until authenticated. Auth endpoints: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/sync` (bidirectional, last-write-wins per key).

Flow: check `authToken` → show gate if missing/expired → on login pull settings + start 60s sync → on register push defaults.

**Synced settings (53 keys):** feedSources, customFeeds, qualityFilter, qualityPrompt, qualityThreshold, qualityCache, hiddenPosts, savedPosts, readPosts, qualityTestTitles, paperRatings, theme, accentColor, spinner, userName, sidebarOrder, clickSound, clickSoundType, clickAether, rainNoiseType, rainVolume, rainFreq, editorTheme, rainSidebarVisible, pixelPet, pixelPetType, pixelPetMode, feedNotifications, seenPostLinks, adBlockEnabled, feedNotifSources, browseBarOrder, browseHistory, webSearchHistory, chatThreads, aetherColor, interestProfile, urlBarSections, blockedWords, qualityBypass, searchHistory, userQuotes, repostedLinks, fyWeightBase, fyWeightAffinity, fyWeightRecency, maxPerCategoryRun, smartHighlights, chatModel, chatTools, insightsAllowHeuristics, iconSize, hiddenSidebarIcons

### External APIs

arXiv (RSS + API), Hacker News, Semantic Scholar, Ollama (`localhost:11434`), DuckDuckGo, Polymarket

## Development Tools

### Function Registry

Tool for analyzing global function definitions, call sites, and dependencies across all 26 vanilla JS files (paper-sidebar.js removed as of 2026-02-11). Includes scope-aware duplicate detection and script load order validation.

**Usage:**
```bash
npm run function-registry              # Full analysis + generates reports
npm run validate-feeds                 # Check feed catalog sync
npm run validate-load-order            # Check script load order
npm run suggest-reorder                # Suggest load order improvements
```

**In-app:** Dev panel (`#dev`) has "Analyze Functions" button that runs `/api/function-registry` and displays:
- Total functions, duplicates (by severity), unused functions, file count
- Top 5 duplicate function definitions (with locations)
- First 10 unused functions (potential dead code)
- Top 5 most-called functions

**Outputs:**
- `coverage/function-registry.json` - Full machine-readable report with all functions, call sites, dependencies
- `coverage/function-registry.html` - Interactive HTML report with searchable tables, filterable views, file-by-file breakdown

**Function Registry Reports Include:**
- Function definitions (type, file, line number, scope/nesting)
- Call counts and call sites
- **Scope-aware duplicates** - Classified by severity:
  - **ERROR**: Multiple global definitions (real naming conflict)
  - **WARNING**: Multiple definitions at same scope level (possible bug)
  - **INFO**: Nested in different functions (intentional, e.g., `onMove`, `handler`)
- Unused functions (defined but never called)
- Cross-file dependencies (what each file calls from others)
- Most-called functions ranking

**Feed Catalog Validator (`validate-feeds`):**
- Validates `FEED_CATALOG` sync between `src/js/core.js` and `src/feed_catalog.py`
- Checks that `key`, `url`, and `special` fields match exactly
- Reports: MISSING_IN_PY, MISSING_IN_JS, URL_MISMATCH, SPECIAL_MISMATCH
- Exit code 0 = in sync, 1 = mismatches found (suitable for CI/CD)
- Supports `--json` flag for machine-readable output

**Script Load Order Validator (`validate-load-order`):**
- Parses script order from `src/index.html`
- Detects forward references (file A calls function before file B defines it)
- Classifies by severity:
  - **WARNING**: Top-level immediate execution (risky, may fail at runtime)
  - **INFO**: Inside function or deferred (safe with `defer` attribute)
- Detects circular dependencies (acceptable with `defer`)
- Shows dependency graph between files

Script locations: `scripts/function-registry.js`, `scripts/validate-feeds.js`

## Key Conventions

- Dark/light themes, accent `#b4451a`, Tailwind via CDN
- No frameworks/bundlers — all vanilla JS
- Tests: `npm test` (node:test + vitest). Syntax check: `node -c file.js`
- Feed rendering is data-driven from `FEED_CATALOG`; catalog must stay in sync between `js/core.js` and `feed_catalog.py`
- `getSourceChip(source, arxivId)` → inline logo + name; `catalogLogo(entry, size)` → SVG/img logos
- Quality prompts: `DEFAULT_VERDICT_PROMPT` / `DEFAULT_SCORING_PROMPT` in `persistence.py`, mirrored in `quality.js`
