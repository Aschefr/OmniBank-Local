<!-- GSD:project-start source:PROJECT.md -->

## Project

**OmniBank Local**

Local-first personal finance app with optional AI assistant (Ollama). Zero cloud — SQLite DB lives on-device, everything runs offline. Modern mobile-first UI wrapping spreadsheet-level financial control. Supports Organisation Mode for small teams/associations under a paid license key.

Target: Privacy-conscious individuals; French associations/CSE needing lightweight shared finance tools without external hosting costs or privacy tradeoffs.

**Core Value:** Financial data sovereignty — your records never leave your machine — while still getting intelligent decision support from a local LLM (RAG chat, smart categorisation, trend analysis) entirely offline.

### Constraints

- **Privacy**: No external API calls beyond user-configured Ollama endpoint — zero telemetry, zero tracking
- **Language**: French primary language throughout; English translation mandatory for every new i18n key
- **Tech stack**: Python FastAPI backend, vanilla JS frontend, SQLite (SQLAlchemy), Tauri (Rust) desktop wrapper, Chart.js visualisation
- **Accounting precision**: Round-trip CSV benchmark must pass exactly against reference image — decimal accuracy is non-negotiable
- **Debug logs**: Backend/frontend debug output written in French per rule G-04 Construction Plan.yaml
- **LLM prompts**: System prompts for Ollama must be English for function calling stability; response language injected dynamically by backend

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

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

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
