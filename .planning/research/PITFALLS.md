# Pitfalls Research

Known gotchas for next-phase planning (from Construction Plan.yaml KG-01 through KG-04):

| ID | Context | Risk | Mitigation |
|----|---------|------|------------|
| KG-01 | Flag icons in navigation | Windows doesn't render flag emojis reliably | Use `flag-icons` CDN, not emoji characters |
| KG-02 | Recurrence filter regression | Templates showing just because un-closed | Filter by transaction presence in selected year, never `is_closed` alone |
| KG-03 | Year-end wizard generation | Un-checked templates spawning next-year transactions | Only generate for explicitly renewed templates; mark others `is_closed=true` |
| KG-04 | Git history rewrite | Push requires `--force` after PII purge | Documented in CLAUDE.md rule 7, enforce consistently |

# Anti-Patterns to Avoid (from shipped fixes)

- SQLite lock under parallel API calls → already fixed with 30s busy timeout in SQLAlchemy
- Virtualized table scroll jank on mobile ≤768px → disabled in v1.0.32 as workaround; proper fix pending
- Auto-categorization timeout → raised to 120s per Improvement_14; monitor Ollama cold-start latency
- i18n JSON cache hit in browser → always use `?v=Date.now()` cache-busting on dynamic fetch calls (Post-Mortem Improvement_12)
