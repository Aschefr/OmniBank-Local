# Research Synthesis — OmniBank Local v1.0.68+

## Domain
Privacy-first personal finance management + local AI assistant via Ollama. Zero-cloud architecture with optional multi-user Organisation Mode (paid license).

## Key Findings

**Stack:**
Python FastAPI + SQLite + vanilla JS frontend + Tauri desktop — all production-validated. No framework migration needed.

**Table Stakes (All Shipped):**
Transaction CRUD, depuis/vers logic, recurring payments, budgets, CSV benchmark, dashboard analytics, AI chat/RAG, PDF export, i18n, setup wizard, Organisation Mode, auto-backup, undo/redo, multi-account CSV import — all complete.

**Remaining (4 items):**
1. OCR receipt scanning (Ollama Vision)
2. Mobile viewport virtualization fix
3. Docker deployment docs
4. Large history performance (50K+ rows)

**Watch Out For:**
- KG-02: Recurrence filter using `is_closed` instead of year presence
- KG-03: Year-end wizard generating for un-checked templates
- Mobile virtual table scroll jank — workaround only, proper fix pending
- Ollama cold-start latency for auto-categorization (120s timeout already set)

## Implications for Roadmap
- 3-4 coarse phases covering the 4 remaining items
- OCR pipeline is lowest-hanging fruit (well-defined, scoped)
- Mobile virtualization fix will require dedicated frontend engineering phase
- Docker/perf improvements can be interspersed as side tasks

## Sources
- Construction Plan.yaml (development history, gotchas, technical rules)
- README.md (current features, recent update history)
- Cahier des charges.md (original v2.1 refined specs)
