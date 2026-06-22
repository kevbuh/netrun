# netrun

A privacy-focused, AI-native smart browser built on Electron. netrun blends a
hardened web browser with local-first AI: ad/tracker blocking, an ambient page
insight pipeline, a research/chat agent runtime, academic paper tooling, and a
custom reactive UI framework — all running against local (Ollama) or cloud
(OpenRouter) models.

## Features

- **Privacy hardening** — HTTPS-only upgrades, tracking-parameter stripping,
  cookie blocking, DNS-over-HTTPS, WebRTC leak prevention, and per-tab privacy
  stats.
- **Ad & YouTube ad blocking** — request-level ad blocking plus protocol-level
  YouTube ad stripping.
- **AI everywhere** — chat, research, and browser agents; an ambient pipeline
  that annotates pages in the background; context files with compaction.
- **Nerd Mode** — an academic paper reader for PDFs and arXiv links with
  references, authors, related work, highlights, and code (Semantic Scholar +
  Papers With Code).
- **Local-first models** — Ollama for on-device inference, OpenRouter for cloud.
- **Integrated feeds** — arXiv, Hacker News, and Polymarket with ranking and
  interest profiling.
- **Encrypted password store** — backed by Electron `safeStorage`.
- **Aether design system & AetherUI** — a CSS token system plus a SolidJS-style
  reactive UI framework.

## Architecture

netrun has three layers:

1. **Main process** (`electron/`) — window management, IPC routing, ad blocking,
   privacy hardening, static server, password store.
2. **Renderer** (`src/index.html` + `src/js/`) — the SPA (Dashboard, Feed, Chat,
   Browse, Research, Settings, and more).
3. **Core backend** (`src/core/` → compiled to `dist/main/`) — TypeScript tool
   registry, agent runtime, LLM providers, SQLite database, and IPC handlers.

See [CLAUDE.md](./CLAUDE.md) for a detailed architecture reference.

## Getting Started

### Prerequisites

- Node.js (with npm)
- Python 3 (for the PDF, captions, and eye-tracking subsystems)
- [Ollama](https://ollama.com/) (optional, for local models)

### Setup

```bash
git clone https://github.com/kevbuh/netrun.git
cd netrun
./setup.sh                 # installs Node + Python dependencies
cp .env.example .env       # configure environment (optional)
```

### Run

```bash
npm run build:core         # compile TypeScript core (src/core/ → dist/main/)
npm run start              # build core + launch Electron
npm run start:dev          # launch without rebuilding (faster iteration)
```

## Testing

```bash
npm test                   # Electron + Vitest + pytest
npm run test:quick         # unit + backend unit only (no integration)
npm run test:unit          # Vitest (frontend/core)
npm run test:backend       # pytest (Python backend)
```

## Linting

```bash
npm run lint               # ESLint (JS) + Ruff (Python)
npm run lint:fix           # auto-fix both
```

## Configuration

Copy `.env.example` to `.env`. All values are optional and have sensible
defaults:

- `GOOGLE_CLIENT_ID` — your own Google Cloud OAuth client ID
- `OLLAMA_HOST` — Ollama API host (default `http://localhost:11434`)
- `NETRUN_VERIFY_SSL` — set to `1` to enable outbound SSL verification

## Tech Stack

Electron · TypeScript · better-sqlite3 · SolidJS-style reactive UI (custom) ·
Ollama / OpenRouter · Vercel AI SDK · Python (PyMuPDF, Parakeet, gaze CNN)
