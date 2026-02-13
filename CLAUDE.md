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
- `routes/` — 12 Flask blueprints: auth, feed, content, browse, vault, experiments, social, neuralook, media, dev
- `db.py` — SQLite database core (connection, init, schema, logging)
- `users.py` — auth, sessions, teams, social features, achievements, calendar
- `cache.py` — caching layer (in-memory, disk, quality, highlights)
- `embeddings.py` — vector embeddings and semantic search
- `annotations.py` — annotation system (feedback, categories, prompts)
- `utils_persistence.py` — utilities (slugify, proxy rewriter, reference cache)
- `feed_parser.py` / `feed_poller.py` / `feed_catalog.py` — feed system

**Frontend JS (`src/js/`):**
- `core/` — 13 core modules (routing, state, auth, UI primitives)
- `browse/` — 15 modules split from former browse-tabs.js (browse-island.js for webview management, browse-downloads.js, browse-annotations.js, browse-passwords.js, etc.)

**Test locations:**
- `src/tests/unit/` — Python unit tests (63 tests)
- `src/tests/integration/` — Python integration tests (325 tests across 11 files)
- `tests/` — Electron tests (Node test runner)
- `src/js/**/*.test.js` — Frontend unit tests (515 tests, Vitest with happy-dom)

**Test coverage:** 1,006 total tests
- Backend integration: 325 tests covering 181 API endpoints (10/12 routes)
- Frontend unit: 618 tests (15 files, 100% pass rate)
- Backend unit: 63 tests

See COMPLETE_MAINTAINABILITY_ACHIEVEMENT.md for full details.

**Integration test files:**
- `test_api_auth.py` (21 tests) - Google OAuth, sessions, user management
- `test_api_browse.py` (28 tests) - Web search, link previews, proxies, stock quotes
- `test_api_content.py` (28 tests) - Text extraction, links, basic annotations
- `test_api_content_extended.py` (34 tests) - Authors, citations, chat memory, annotation feedback
- `test_api_dev.py` (36 tests) - Settings, calendar, images, validation
- `test_api_experiments.py` (39 tests) - Projects, kernels, packages
- `test_api_feed.py` (28 tests) - Feed aggregation, quality filtering
- `test_api_media.py` (14 tests) - Audio transcription, text-to-speech
- `test_api_neuralook.py` (22 tests) - Eye tracking, gaze prediction
- `test_api_social.py` (47 tests) - Teams, messaging, profiles
- `test_api_vault.py` (27 tests) - Notes CRUD, marimo notebooks

## Code Quality

**Module boundaries:** All modules use explicit imports. Import directly from `db`, `cache`, `embeddings`, `annotations`, `users`, `utils_persistence` (not the old `persistence` shim).

**Testing:** 903 total tests (325 integration, 515 frontend, 63 unit). Integration tests document API contracts with real examples. Tests verify error handling, auth, validation. ~88% backend pass rate, 100% frontend pass rate. See FINAL_MAINTAINABILITY_REPORT.md for complete details.
