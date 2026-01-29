# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

```bash
python3 arxiv-filter/server.py
```

Starts an HTTP server on port 8000 serving the app at `http://localhost:8000`.

## Architecture

This is a self-contained arXiv paper browser and experiment tracker with **zero external dependencies** — vanilla JavaScript frontend, Python stdlib backend, no build step.

### Backend — `arxiv-filter/server.py`

Python HTTP server (`http.server`) that acts as an API proxy and local data store:

- `/feed` — proxies arXiv CS RSS feed
- `/api/arxiv-search` — proxies arXiv search API
- `/api/citations` — fetches citation counts from Semantic Scholar batch API
- `/api/experiments` — CRUD for experiments and their versions, stored as JSON files in `arxiv-filter/experiments/`

Experiments are stored on disk as `experiments/{slug}/meta.json`.

### Frontend — `arxiv-filter/index.html`

Single-file SPA (~1900 lines) with embedded CSS and JS. Four views managed by client-side routing:

1. **Home** — arXiv paper feed with masonry grid, sorting (latest/most cited), trend panels, infinite scroll, local storage caching
2. **Paper Viewer** — split layout with metadata sidebar + embedded PDF iframe, citation counts
3. **Experiments List** — create/delete experiment ideas
4. **Experiment Detail** — version tree with SVG visualization, interactive version cards, auto-save (600ms debounce), branching

### External APIs

- arXiv RSS: `https://rss.arxiv.org/rss/cs`
- arXiv API: `https://export.arxiv.org/api/query`
- Semantic Scholar: `https://api.semanticscholar.org/graph/v1/paper/batch`

## Key Conventions

- UI uses a dark theme with accent color `#b4451a`
- No frameworks, bundlers, or package managers — all vanilla
- No tests or linting configured
- Experiment slugs are generated via `slugify()` in `server.py`
