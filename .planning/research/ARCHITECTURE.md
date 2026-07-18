# Architecture Research — OmniBank Local v1.0.68+

## Component Map
```
Browser / Tauri WebView → FastAPI (port 8434) → SQLAlchemy → SQLite (data/*.db)
                                            → Ollama (user-configured endpoint)
Static files served from app/static dirs.
```

## Key File Layout
- `app/` — FastAPI routes, models, business logic (finance engine, stats, budgets, AI)
- `static/` — Vanilla JS, CSS, i18n JSON, images
- `data/` — SQLite DB, user uploads, backups
- `src-tauri/` — Rust desktop wrapper (main.rs, tauri.conf.json)
- `migrations/` — SQL scripts (applied in init_db())
- `docker/` — Dockerfile, nginx.conf

## Data Flow
1. Frontend fetches via fetch() to `http://localhost:8434/api/*`
2. Backend validates with Pydantic schemas, queries via SQLAlchemy
3. Returns JSON → frontend renders into DOM (no virtual DOM, no reactive framework)
4. AI chat: frontend → SSE endpoint → Ollama API → streaming response rendering
5. AI RAG: Ollama issues function call → backend stats API → JSON → natural language response

## Build Order for Remaining Work
- OCR pipeline: lowest cost, well-defined interface (AI+photo→transaction)
- Mobile virtualization: moderate cost, requires frontend component work
- Docker/perf: lowest priority, incremental improvements
