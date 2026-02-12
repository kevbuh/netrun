# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NetRun is a hybrid desktop application for research content aggregation and exploration. It combines a vanilla JavaScript SPA frontend, a Python Flask backend, and an Electron desktop shell. Data is stored in SQLite.

## Commands

```bash
# Run
npm start                    # Launch Electron app (spawns Flask server + desktop shell)
npm run server               # Run Flask server only (port 8000)

# Test
npm test                     # Run all tests (electron + unit + backend)
npm run test:unit            # Vitest: src/js/*.{test,spec}.js
npm run test:backend         # Pytest: src/tests -v
npm run test:electron        # Node tests: tests/**/*.test.js
npm run test:quick           # Fast subset: unit + backend unit tests
npm run test:watch           # Vitest watch mode
npm run test:coverage        # Frontend coverage report
npm run test:coverage:backend # Python coverage (HTML)

# Code quality
npm run dead-code            # Find unused functions
npm run function-registry    # Map all global functions
npm run validate-feeds       # Validate feed catalog
```

## Architecture

**Three-layer monorepo:**
- **Electron** (`electron/main.js`) — Desktop shell, ad-blocking (adblock-rs), IPC for Keychain/passwords/screen capture, window management, spawns the Python server
- **Flask backend** (`src/app.py`) — REST API + WebSocket server on port 8000, uses Flask Blueprints
- **Frontend** (`src/js/`, `src/index.html`) — Vanilla JS SPA (no framework), Tailwind CSS, CodeMirror, xterm.js, KaTeX/MathJax

**Backend structure (`src/`):**
- `app.py` — Flask app init, blueprint registration, WebSocket endpoints
- `persistence.py` — SQLite ORM, schema, feed caching, embeddings, auth (large file, 87KB)
- `helpers.py` — Auth decorators, SSE streaming, arXiv query builder
- `feed_catalog.py` — 45+ feed source definitions
- `feed_parser.py` / `feed_poller.py` — RSS parsing and background polling thread
- `kernels.py` — Jupyter kernel management
- `routes/` — Flask blueprints: auth, feed, content, experiments, social, browse, vault, misc

**Frontend structure (`src/js/`):**
- `browse-tabs.js` — Embedded webview tab manager (6,990 lines)
- `panel.js` — Unified popup/context menu system, inline chat, TTS (4,950 lines)
- `core.js` — Global state, feed catalog, UI utilities, Dynamic Island (4,390 lines)
- `feed.js` — Feed browsing/filtering/search
- `dashboard.js` — Main dashboard with widgets
- `settings.js`, `editors.js`, `notebook-editor.js`, `experiments.js`, `teams.js`, `terminal.js` — Feature modules
- `storage.js`, `utils.js` — Shared utilities

**Key patterns:**
- Frontend uses global state (window scope variables) and event-driven UI
- Backend streams LLM responses via Server-Sent Events (SSE)
- Optional local Ollama integration for quality filtering, embeddings, annotations
- Google OAuth for auth; tokens stored in Keychain via Electron safeStorage
- WebSocket used for terminal, captions, file uploads

## Testing

- **Frontend tests** use Vitest with Happy-DOM; setup in `src/tests/setup.js` provides mock localStorage/fetch/RAF
- **Backend tests** use Pytest; `src/tests/conftest.py` provides fixtures and mocks for external APIs (Ollama, Semantic Scholar, arXiv)
- Test markers: `unit`, `integration`, `slow`, `requires_ollama`, `requires_db`
- Frontend tests live alongside source: `src/js/*.test.js`
- Backend tests in `src/tests/unit/` and `src/tests/integration/`

## Setup

```bash
./setup.sh  # Full setup: Homebrew, Python 3.11, Node, Ollama, venv, dependencies
# Or manually:
npm install
venv/bin/pip install -r requirements.txt
```
