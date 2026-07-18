# Stack Research — OmniBank Local v1.0.68+

## Current Stack (Production)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Python FastAPI + Uvicorn | uvloop/httptools under Docker |
| ORM | SQLAlchemy + SQLite | 30s busy timeout, PRAGMAs tuned |
| Data | Pandas | CSV parsing only |
| Frontend | Vanilla HTML5/CSS3/JS | Chart.js, VirtualTable for large data |
| Desktop | Tauri 2.x (Rust) | PyInstaller --onedir bundle |
| AI | Ollama local API | Auto-detect via /api/tags |
| Container | Docker + Nginx | SSE streaming via X-Accel-Buffering: no |
| I18n | JSON (fr.json, en.json) | UTF-8-sig BOM, Python-side writes only |

## What NOT to introduce next phase
- No frontend framework migration (React/Vue/Svelte) — vanilla JS proven, no build pipeline benefit
- No Postgres migration — SQLite sufficient for local-first
