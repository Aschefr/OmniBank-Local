# OmniBank Local

## What This Is

Local-first personal finance app with optional AI assistant (Ollama). Zero cloud — SQLite DB lives on-device, everything runs offline. Modern mobile-first UI wrapping spreadsheet-level financial control. Supports Organisation Mode for small teams/associations under a paid license key.

Target: Privacy-conscious individuals; French associations/CSE needing lightweight shared finance tools without external hosting costs or privacy tradeoffs.

## Core Value

Financial data sovereignty — your records never leave your machine — while still getting intelligent decision support from a local LLM (RAG chat, smart categorisation, trend analysis) entirely offline.

## Business Context

- **Customer**: Privacy-focused individuals + small associations (Loi 1901), CSE committees
- **Revenue model**: Free personal use; paid license keys unlock Organisation Mode
- **Success metric**: Accounting precision validated by CSV round-trip benchmark × local AI adoption rate
- **Strategy notes**: See `Construction Plan.yaml` for full phase history & roadmap tracking

## Requirements

### Validated

- ✓ Transaction CRUD with depuis/vers sign logic and instant balance recalculation
- ✓ Recurring transactions (template → instance) with year-end wizard
- ✓ Budget envelope system per category/project with progress gauges
- ✓ User-created categories grouped by transaction type (no defaults)
- ✓ CSV import/export with round-trip benchmark validation
- ✓ Dashboard: timeline view, net worth, "reste à vivre", overdraft simulator
- ✓ Synthesis pivot table (category × month) with configurable annual totals
- ✓ Local AI chat via Ollama using RAG/function calling against live statistics API
- ✓ PDF report export with custom headers and page break control
- ✓ i18n: French + English, BOM-safe JSON (UTF-8-sig)
- ✓ Setup wizard for first-launch account configuration
- ✓ Organisation Mode: multi-user profiles, audit trail columns, license key gating
- ✓ Auto-backup scheduler with configurable rotation
- ✓ Undo/Redo system with global activity log and toast notifications
- ✓ Multi-account CSV block parsing with validation alerts

### Active

- [ ] OCR receipt scanning pipeline (Ollama Vision model: photo → proposed entry → user validation)
- [ ] Mobile viewport virtualization hardening for 50K+ row datasets
- [ ] Docker deployment improvements (container orchestration, health checks, volume persistence docs)
- [ ] Performance optimization for very large transaction histories

### Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud sync / multi-device | Violates core value proposition — zero-cloud privacy model |
| External accounting integrations (QuickBooks/Xero) | Focus on self-contained workflow preserving data sovereignty |
| Real-time collaboration editing | Organisation Mode provides audit-style multi-user, not collaborative |

## Constraints

- **Privacy**: No external API calls beyond user-configured Ollama endpoint — zero telemetry, zero tracking
- **Language**: French primary language throughout; English translation mandatory for every new i18n key
- **Tech stack**: Python FastAPI backend, vanilla JS frontend, SQLite (SQLAlchemy), Tauri (Rust) desktop wrapper, Chart.js visualisation
- **Accounting precision**: Round-trip CSV benchmark must pass exactly against reference image — decimal accuracy is non-negotiable
- **Debug logs**: Backend/frontend debug output written in French per rule G-04 Construction Plan.yaml
- **LLM prompts**: System prompts for Ollama must be English for function calling stability; response language injected dynamically by backend

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Template → Instance recurrence model | Each generated transaction editable independently without breaking series | ✓ Good — prevents cascade edits, year-end wizard handles annual renewal cleanly |
| Manual CSV parser over automated importers | Bank formats vary wildly; round-trip benchmark catches drift early | ✓ Good — exact matching against reference image validates calculations |
| RAG via function calling (not prompt stuffing) | Grounds AI answers in live data without token overuse | ✓ Good — accurate responses even with large transaction histories |
| Organisation Mode license gating | Revenue stream funds ongoing development; basic encryption sufficient for non-hostile context | ✓ Good — simple key validation persists across updates, not adversarial-grade |
| Auto-backup scheduler on backend | Protects against disk failure without user action required | ✓ Good — silent operation avoids notification fatigue while preserving data |

---
*Last updated: 2026-07-18 after project initialization*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**: Requirements move between Active/validated/out of scope as features ship or get deferred. Decisions log grows with new entries. Core value statement rarely changes — if it does, that signals a pivot warranting discussion.

**After each milestone**: Full review of all sections. Audit Out of Scope reasons for validity. Update Context with current state (users, feedback metrics). Verify "What This Is" still accurately describes the product.
