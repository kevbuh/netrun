# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Netrun

Netrun is a smart browser built as an Electron desktop app. It combines web browsing with research tools, an AI agent system, a built-in terminal, notebook editor, knowledge graph, and more.

## Commands

```bash
# Run the app
npm start              # Build TypeScript core, then launch Electron
npm run start:dev      # Launch Electron without rebuilding core TS

# Build
npm run build:core     # Compile src/core/**/*.ts → dist/main/

# Test
npm test               # Run all tests (electron + vitest + pytest)
npm run test:unit      # Vitest only (src/**/*.test.js)
npm run test:backend   # Pytest only (src/tests/)
npm run test:backend:unit       # Pytest unit tests only
npm run test:backend:integration # Pytest integration tests only
npm run test:electron  # Node test runner (tests/**/*.test.js)
npm run test:quick     # Vitest + pytest unit tests only
npm run test:watch     # Vitest in watch mode
npm run test:ui        # Vitest with browser UI
npm run test:coverage  # Vitest with coverage report

# Lint
npm run lint           # ESLint (src/js/ + electron/) + Ruff (src/)
npm run lint:js        # ESLint only
npm run lint:py        # Ruff only
npm run lint:fix       # Auto-fix both JS and Python

# Utilities
npm run dead-code          # Find unused code
npm run function-registry  # Audit function registry
npm run validate-feeds     # Validate feed configs
npm run validate-load-order # Check script load order
```

## Architecture

### Two-layer structure

- **Electron main process** (`electron/main.js`, `electron/password-store.js`, `electron/preload.js`): Window management, ad blocking (adblock-rs), password store (macOS Keychain via safeStorage), IPC handlers for browser features.
- **Core TypeScript system** (`src/core/`): Compiled to `dist/main/` via `tsc`. Provides the tool registry, LLM provider registry, agent runtime, SQLite database (better-sqlite3), and IPC handlers. Initialized from `src/core/init.ts` at app startup. Uses the Vercel AI SDK (`ai` package) with Zod for schema validation.
- **Renderer** (`src/`): HTML views in `src/views/`, vanilla JS in `src/js/`, loaded via `<script>` tags (not modules). Uses the Aether design system (`src/aether/`) with CSS custom properties (`--nr-*` tokens) for theming. The renderer communicates with main via the `electronAPI` bridge exposed in `electron/preload.js`.

### Key subsystems in `src/core/`

- **Tools** (`src/core/tools/`): Registry pattern — each tool category (browser, calendar, content, context, feed, media, search, social, system) registers via `ToolRegistry`. Tools are callable by the agent system.
- **Providers** (`src/core/providers/`): LLM provider abstraction. **Only use local LLMs via Ollama** — do not use OpenAI or Anthropic APIs.
- **Agents** (`src/core/agents/`): Agent runtime with tool-calling loop. Built-in research assistant agent.
- **Ambient** (`src/core/ambient/`): Ambient processing pipeline for background tasks.
- **Database** (`src/core/db/`): SQLite via better-sqlite3 with WAL mode. Schema in `schema.ts`, query modules in `queries/`.
- **Context** (`src/core/context/`): Living context system. Markdown files in `~/.netrun/context/` (main.md + task-*.md). `manager.ts` handles CRUD, `compaction.ts` handles LLM-based summarization. Metadata tracked in SQLite `context_meta` table. IPC handlers use `db:context-*` prefix.
- **Python** (`src/core/python/`): Python process management and text utilities.
- **Managers**: `terminal-manager.ts` (node-pty terminal sessions), `kernel-manager.ts` (Jupyter-style kernels), `captions-manager.ts` (media captions), `neuralook-manager.ts` (visual analysis), `parakeet-manager.ts` (speech/audio processing).
- **IPC** (`src/core/ipc-handlers.ts`): Central IPC handler registration connecting renderer requests to core functionality. Renderer calls `electronAPI.dbQuery(channel, ...args)` which maps to `ipcMain.handle('db:' + channel, ...)`.

### Aether design system (`src/aether/`)

- **CSS tokens** (`src/aether/css/tokens.css`): Source of truth for all `--nr-*` custom properties. Foundation CSS files alongside it: `reset.css`, `layout.css`, `typography.css`, `surfaces.css`, `animations.css`, `ambient.css`.
- **Component CSS** (`src/aether/css/components/`): buttons, cards, inputs, pills, menus, modals, toast, tooltips, aether-ui.
- **Feature CSS** (`src/aether/css/features/`): 27 feature-specific stylesheets loaded via `<link>` tags in `index.html`.
- **Themes** (`src/aether/css/themes/`): dark, light, daylight, clear.
- **JS modules**: `aether.js` (main entry), `tokens.js`, `motion.js`, `materials.js`, `ambient.js`, `cursor.js`. Exposed as `window.Aether`.
- **AetherUI** (`src/aether/ui/`): Declarative UI framework — `State`, `Computed`, `Effect` (SolidJS-style signals), layout primitives (`VStack`, `HStack`, `ZStack`), controls (`Button`, `TextField`, `Toggle`, `Slider`, `Picker`), overlays (`Sheet`, `Alert`, `Popover`, `Menu`). Exposed as `window.AetherUI` and `Aether.ui`.

### Frontend JS conventions

- `src/js/` files are plain browser JS (`sourceType: 'script'`), not ES modules. They use the global `electronAPI` object for IPC.
- Organized by feature: `core/` (routing, sidebar, layout, state, audio, sounds, auth, navigation, profile, context-intake, UI utils, icons), `browse/` (tabs, sessions, passwords, agent, annotations, audio, captions, downloads, features, island, menu, NTP, paper, pill, split-panes, state, windows), `settings/` (theme, colors, sections, core, init).
- Feature modules at top level: api, calendar, chat-threads, dashboard, draw-editor, feed, neuralook, notebook-editor, onboarding, panel (chat, commands, state, tts), pixel-pet, quality, search, terminal, vibe, whiteboard.
- Tests co-located as `*.test.js` files, run by Vitest with happy-dom.

#### Rendering conventions

- New UI code uses AetherUI (`VStack`, `HStack`, `Text`, `Button`, `ForEach`, etc.)
- `RawHTML()` bridges HTML strings (SVG icons, incremental migration)
- `innerHTML = ''` is fine for clearing containers before `AetherUI.mount()`
- `document.createElement` is fine for canvas/video/low-level DOM
- Avoid `innerHTML` with template literals for building UI

#### State management conventions

- `Settings.get/set/getJSON/setJSON` for all persisted preferences and app state
- Raw `localStorage` only for auth tokens (`authToken`, `authUser`, `authUserInfo`)
- `sessionStorage` only for session-scoped ephemeral data (guest mode stash, focus timers)
- Global module variables (`core-state.js`, `browse-state.js`, `panel-state.js`) for runtime-only state
- `electronAPI.dbQuery` for backend data operations, not client-side state

### Views (`src/views/`)

HTML pages: algorithm, author-profile, blog, dashboard, dev, inbox, neuralook, onboarding, profile, quality, research, settings, vibe.

### Python (legacy/auxiliary)

- Some Python remains in `src/` (kernels, feed catalog). Backend tests in `src/tests/` via pytest.
- Python venv at `./venv/`, pytest runs via `venv/bin/pytest`.
- Linted with Ruff.
