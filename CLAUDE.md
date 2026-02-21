# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run build:core        # TypeScript src/core/ → dist/main/
npm run start             # Build + launch Electron
npm run start:dev         # Launch without rebuild (faster iteration)
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

1. **Main process** (`electron/main.js`, `electron/preload.js`) — window management, IPC routing, static file server on port 8000, adblock engine, keyboard shortcuts, webview management
2. **Renderer** (`src/index.html` + `src/js/`) — SPA loaded from localhost:8000. Four main views: Dashboard, Feed, Chat, Browse. Plain browser JS (not ES modules in `src/js/`, ES modules in `src/aether/ui/`)
3. **Core backend** (`src/core/` → compiled to `dist/main/`) — TypeScript, registered at app startup via `src/core/init.ts`. Provides tool registry, agent runtime, LLM providers, database, IPC handlers

### IPC Communication

Frontend calls backend via `window.electronAPI` (exposed through context bridge in `preload.js`):
```javascript
window.electronAPI.toolExecute(name, input, context)
window.electronAPI.dbQuery('query-name', ...args)
```

IPC handlers live in `src/core/ipc/` (one file per subsystem). Tool execution goes through `src/core/tools/registry.ts`.

### Aether Design System

Custom design system with CSS tokens + JS framework:
- **Token source of truth**: `src/aether/css/tokens.css` — all `--nr-*` CSS custom properties
- **Themes**: `src/aether/css/themes/` (dark, light, daylight, clear)
- **Component CSS**: `src/aether/css/components/`
- **Feature CSS**: `src/aether/css/features/` (loaded via `<link>` tags in index.html)
- **JS**: `src/aether/aether.js` (namespace), `motion.js`, `materials.js`, `ambient.js`, `tokens.js`

### AetherUI Framework (`src/aether/ui/`)

SolidJS-style reactive UI: `State(val)`, `Computed(fn)`, `Effect(fn)`, `Store(obj)`, `batch(fn)`

Views: `VStack`, `HStack`, `ZStack`, `Text`, `Button`, `TextField`, `Toggle`, `Slider`, `Picker`, `ForEach`, `List`, `Section`

Overlays: `Sheet`, `Alert`, `Popover`, `Menu`

Modifiers resolve to tokens: `.padding(4)` → `var(--nr-space-4)`, `.background('surface')` → `var(--nr-bg-surface)`

Adding children after construction: use `view.add(child1, child2)` (public API, returns `this`). For appending a View into a raw DOM element: `AetherUI.append(view, domEl)`. Never call `._appendChildren()` or `.build()` directly in consumer code.

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

**PDF Conversion** — IPC subsystem for PDF operations via Python subprocess:
- `src/core/ipc/pdf-convert.ts` + `src/core/python/pdf-convert.py`
- Handlers: `pdf:parse`, `pdf:extract`, `pdf:split`, `pdf:merge`, `pdf:compress`, `pdf:to-png`, `pdf:to-jpeg`, `pdf:from-images`, `pdf:md-to-pdf`, `pdf:to-md`
- Dependencies: PyMuPDF (fitz), Pillow

### Feeds

- Catalog system in `src/core/ipc/feeds.ts` — multi-source feed aggregator
- Sources: `{ key, url?, special? }` where special can be `'arxiv'`, `'hn'`, `'polymarket'`
- Freshness: 10-minute stale threshold per source, on-demand fetching
- Custom RSS/Atom XML parsing (no external lib)
- API route: `POST /api/feed-items/catalog` with `{ entries: [...], limit? }`

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
- `TabView` caches rendered tabs via `display:none`, not rebuild
- `Store` is deep reactive: use `store.get('path')`, `store.set('path', val)`, `store.update('path', fn)`
