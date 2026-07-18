# Features Research — OmniBank Local v1.0.68+

## Already Implemented (Table Stakes)
- Transaction CRUD, depuis/vers sign logic, balance recalculation
- Recurring transactions (template → instance), year-end wizard
- Budget envelope system per category/project
- User-created categories (no defaults), grouped by type
- CSV import/export with round-trip benchmark validation
- Dashboard: timeline, net worth, reste à vivre, overdraft simulator
- Synthesis pivot table (category × month), configurable annual totals
- Local AI chat via Ollama: RAG + function calling
- PDF export with custom headers, page breaks, account filters
- Setup wizard for first-launch configuration
- Organisation Mode: multi-user profiles, audit trail, license gating
- Auto-backup scheduler with configurable rotation
- Undo/Redo system with activity log
- Multi-account CSV block parsing with validation alerts

## Remaining Active (v2 targets)
| Feature | Complexity | Dependencies |
|---------|-----------|-------------|
| OCR receipt scanning (Ollama Vision) | Medium | Mobile strategy, Vision model selection |
| Mobile viewport virtualization | High | VirtualTable component rewrite |
| Docker deployment docs/persistence | Low | None |
| Large history performance (50K+ rows) | Medium | VirtualTable optimization or replacement |
