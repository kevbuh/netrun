# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run build:core        # TypeScript src/core/ → dist/main/
npm run start             # Build + launch Electron
npm run start:dev         # Launch without rebuild (faster iteration)
npm run feedserver:build  # Go build → dist/feedserver
npm run feedserver:start  # Build feedserver + start electron
npm run feedserver:start-dev  # go run (no build) + electron
```

## Testing

```bash
npm test                  # All: Electron + Vitest + pytest
npm run test:unit         # Vitest (frontend/core unit tests)
npm run test:electron     # Node --test (Electron tests)
npm run test:backend      # pytest (Python backend)
npm run test:quick        # Unit + backend unit only (no integration)
npm run test:watch        # Vitest watch mode
```

Single test examples:
```bash
npx vitest run src/js/some-file.test.js          # Single Vitest file
venv/bin/pytest src/tests/unit/test_file.py -v    # Single pytest file
venv/bin/pytest src/tests/unit/test_file.py::TestClass::test_name -v  # Single test
```

## Linting

```bash
npm run lint              # ESLint (JS) + Ruff (Python)
npm run lint:fix          # Auto-fix both
```

## Architecture

**Electron desktop app** with three layers:

1. **Main process** (`electron/main.js`, `electron/preload.js`) — window management, IPC routing, static file server on port 8000, adblock engine, keyboard shortcuts, webview management, privacy hardening (WebRTC leak prevention, permission handler, favicon proxy, encrypted API key storage via `safeStorage`)
2. **Renderer** (`src/index.html` + `src/js/`) — SPA loaded from localhost:8000. Four main views: Dashboard, Feed, Chat, Browse. Plain browser JS (not ES modules in `src/js/`, ES modules in `src/aether/ui/`)
3. **Core backend** (`src/core/` → compiled to `dist/main/`) — TypeScript, registered at app startup via `src/core/init.ts`. Provides tool registry, agent runtime, LLM providers, database, IPC handlers

### IPC Communication

Frontend calls backend via `window.electronAPI` (exposed through context bridge in `preload.js`):
```javascript
window.electronAPI.toolExecute(name, input, context)
window.electronAPI.dbQuery('query-name', ...args)
```

IPC handlers live in `src/core/ipc/` (one file per subsystem). Tool execution goes through `src/core/tools/registry.ts`.

### Feed Server

Standalone Go microservice at `feedserver/` — sole feed data path (replaces old IPC feed handlers):
- Packages: `internal/api`, `internal/fetch`, `internal/model`, `internal/rank`, `internal/store`
- Default port: `8400` (configurable via `--port` flag or `FEEDSERVER_PORT` env var)
- Own SQLite DB at `feedserver/feedserver.db`
- Auto-refreshes all sources every 10 minutes + initial refresh on startup
- Frontend (`src/js/feed.js`) connects directly to `http://localhost:8400`

### Aether Design System

Custom design system with CSS tokens + JS framework:
- **Token source of truth**: `src/aether/css/tokens.css` — all `--nr-*` CSS custom properties
- **Themes**: `src/aether/css/themes/` (dark, light, daylight, clear)
- **Component CSS**: `src/aether/css/components/`
- **Feature CSS**: `src/aether/css/features/` (loaded via `<link>` tags in index.html)
- **JS**: `src/aether/aether.js` (namespace), `motion.js`, `materials.js`, `ambient.js`, `tokens.js`

### AetherUI Framework (`src/aether/ui/`)

SolidJS-style reactive UI: `State(val)`, `Computed(fn)`, `Effect(fn)`, `Store(obj)`, `batch(fn)`

Views: `VStack`, `HStack`, `ZStack`, `Text`, `Button`, `TextField`, `Toggle`, `Slider`, `Picker`, `ForEach`, `List`, `Section`, `Grid`, `ScrollView`, `Label`, `Kbd`, `RawHTML`, `Checkbox`, `RadioGroup`, `Textarea`, `ProgressBar`, `Pill`, `FormField`, `SearchField`, `Spinner`, `Disclosure`, `Badge`, `SegmentedControl`, `Skeleton`, `Group`, `Show`, `EmptyState`, `VirtualList`, `Toast`

Additional state primitives: `untrack(fn)`, `Context`

Overlays: `Sheet`, `Alert`, `Popover`, `Menu`

Modifiers resolve to tokens: `.padding(4)` → `var(--nr-space-4)`, `.background('surface')` → `var(--nr-bg-surface)`

Key APIs:
- `view.add(child1, child2)` — append children post-construction (returns `this`)
- `AetherUI.append(view, domEl)` — append a View into a raw DOM element
- `AetherUI.mount(view, targetEl)` — mount a View, disposing any previously mounted view
- `AetherUI.serialize(view)` — walk a view tree into a semantic indented string (useful for AI context)
- `RawHTML(htmlString)` — wrap trusted HTML (e.g. SVG icons) as a View
- `view.id('myId')` — set `el.id` via modifier API
- `view.el` — the live DOM element, already built at construction

Never call `._appendChildren()` or `.build()` in consumer code. Use `view.el` to access the DOM element directly.

Menu API supports anchor-toggle (`Menu(anchor, items)`), context-menu positioning (`Menu(null, items)` + `menu.showAt(x, y)`), icon items (`{ icon, label, handler }`), custom view rows (`{ view: fn }`), trailing content (`{ trailing: fn }`), and dividers (`{ divider: true }`).

Settings navigation is reactive: `_settingsSection` is a `State()` signal driving `Switch` for section content, reactive sidebar active state, and reactive title. Other settings files can still call `renderSettingsView()` to refresh within-section content.

### Browse Features

**Nerd Mode** — academic paper reader for PDFs and arXiv links:
- `src/js/browse/browse-nerd-mode.js` (orchestrator), `browse-nerd-panel.js` (lookup panel), `browse-pdf-viewer.js` (PDF.js renderer)
- Auto-eligible for `.pdf` URLs and arXiv links via `_isNerdAutoEligible(url)`
- Panel tabs: Info, References, Authors, Related, Highlights, Code, Search
- Uses Semantic Scholar + Papers With Code APIs for metadata
- Per-tab state stored on `tab._pdfDoc`, `tab._pdfHighlights`, etc.
- First 20 pages injected into `window._pendingTabContexts` for AI chat context
- S2 data cached in DB with cache age indicator; IPC: `db:s2-cache-age`, `db:s2-cache-clear`

**Pinch-to-Magnify** — gesture relay for webview iframes:
- Content script injected into webviews relays gesture events via `console.log` messages (`__AETHER_MAGNIFY_*` protocol)
- Persistent magnification (no snap-back), centered on cursor, max 5x zoom
- PDF viewer has its own pinch-to-zoom (scale range 0.5–4.0), magnify system skips it

**Page Info Pill** (`src/js/browse/browse-pageinfo.js`, `src/js/toolbar/toolbar-ai-pill.js`):
- `_getPageInfoState()` → `{ label, badges, meta }` — relative age, reading time, scroll %, token count
- Unified AI pill consolidates mic/AI/audio/pulse/pageinfo states with priority ordering

**PDF Conversion** — IPC subsystem for PDF operations via Python subprocess:
- `src/core/ipc/pdf-convert.ts` + `src/core/python/pdf-convert.py`
- Handlers: `pdf:parse`, `pdf:extract`, `pdf:split`, `pdf:merge`, `pdf:compress`, `pdf:to-png`, `pdf:to-jpeg`, `pdf:from-images`, `pdf:md-to-pdf`, `pdf:to-md`
- Dependencies: PyMuPDF (fitz), Pillow

### Feeds

Now served by the Go feed server (see Feed Server section above). Legacy IPC feed handlers have been removed.

### Tool & Agent System

- Tools registered in `src/core/tools/` by category (browser, feed, calendar, search, content, system, media, social, context)
- Agents in `src/core/agents/builtin/` — research, chat, browser agents
- Agent runtime in `src/core/agents/runtime.ts`

### Database

better-sqlite3 with WAL mode. Connection singleton in `src/core/db/connection.ts`, schema in `src/core/db/schema.ts`. Query handlers mapped in `src/core/ipc/db-queries.ts`.

## Conventions

- CSS custom properties: `--nr-*` prefix. Class names: `.nr-*` prefix
- `--aether-*` vars are for the chat panel theme only (separate from main app theme)
- All JS in `src/js/` uses global `electronAPI` — plain browser scripts, not ES modules
- IIFE + `var` pattern for Aether JS files (matches existing conventions)
- Guard Aether calls: `if (window.Aether && Aether.materials) { ... }`
- `.onAppear()` and `.animation()` stack (array-based), never overwrite
- Use `view.add(child)` to append children, never `view._appendChildren()` or `parent.el.appendChild(child.build())`
- Never call `.build()` on a view in consumer code; use `view.el` for the live DOM element
- Use `AetherUI.mount(view, target)` instead of `target.innerHTML = ''; target.appendChild(view.build())`
- Use `RawHTML(svgString)` instead of `el.innerHTML = svgString` for icon SVGs inside View trees
- `TabView` caches rendered tabs via `display:none`, not rebuild
- `Store` is deep reactive: use `store.get('path')`, `store.set('path', val)`, `store.update('path', fn)`
- `@signal` comment annotation marks `State()` signals in source (e.g. `core-state.js`, `browse-state.js`)
