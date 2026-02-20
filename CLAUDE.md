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
- `TabView` caches rendered tabs via `display:none`, not rebuild
- `Store` is deep reactive: use `store.get('path')`, `store.set('path', val)`, `store.update('path', fn)`
