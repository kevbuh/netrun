# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is NetRun

A desktop research paper management app built with Electron + Flask. Features include feed reading, web browsing with ad-blocking, experiment vaults, social collaboration, vector search, and media processing.

## Commands

```bash
npm start              # Start Electron app (launches Flask server automatically)
npm run server         # Start Python backend only

npm test               # Run all tests (Electron + Vitest + Pytest)
npm run test:unit      # Vitest unit tests only
npm run test:backend   # Pytest backend tests only
npm run test:electron  # Electron integration tests (Node test runner)
npm run test:quick     # Fast: unit + backend unit only
npm run test:watch     # Vitest watch mode

npm run dead-code      # Find unused code
npm run function-registry  # Validate module exports & load order
```

Run a single Vitest test: `npx vitest run path/to/test.js`
Run a single Pytest test: `cd src && python -m pytest tests/unit/test_file.py::test_name`

Pytest markers: `@pytest.mark.unit`, `@pytest.mark.integration`

## Architecture

**Three layers:**
- **Electron main process** (`electron/main.js`) — window management, IPC handlers, ad-block engine, Python server lifecycle, password store
- **Flask backend** (`src/app.py`) — API routes as blueprints, WebSocket endpoints, database, embeddings
- **Vanilla JS frontend** (`src/js/`) — core modules + browse modules, served by Flask

**IPC bridge:** `electron/preload.js` exposes `window.electronAPI.*` to renderer for ad-block, downloads, screen capture, auth, passwords.

**Backend modules (under `src/`):**
- `routes/` — 10 Flask blueprints: auth, feed, content, browse, vault, experiments, social, neuralook, media, dev
- `db.py` — SQLite database core
- `users.py` — auth, sessions, teams, social features
- `cache.py` / `embeddings.py` / `annotations.py` — split from former monolithic persistence.py
- `persistence.py` — compatibility shim re-exporting the above
- `feed_parser.py` / `feed_poller.py` / `feed_catalog.py` — feed system

**Frontend JS (`src/js/`):**
- `core/` — 13 core modules (routing, state, auth, UI primitives)
- `browse/` — 15 modules split from former browse-tabs.js (browse-island.js for webview management, browse-downloads.js, browse-annotations.js, browse-passwords.js, etc.)

**Test locations:**
- `src/tests/unit/` and `src/tests/integration/` — Python tests
- `tests/` — Electron tests (Node test runner)
- Vitest config: `vitest.config.js` (happy-dom environment)
