# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Served by a local FastAPI server; also packaged as a Tauri desktop app and a Capacitor Android/iOS app that wrap the same web UI.)

## Users

Two audiences that matter equally:

- **Individuals and households** managing their own bank accounts, savings and budgets.
- **Associations** (loi 1901, CSE) whose treasurer keeps the books, unlocked by the "Mode Organisation" commercial licence.

Both use the app as much on PC as on mobile: long management sessions at the computer (reconciling, categorising, analysing) and quick entries, checks and reconciliations on the phone during the day.

## Product Purpose

Self-hosted personal and associative finance, with absolute priority on data integrity (exact accounting) and a local AI assistant. Success means the user trusts the balances to the cent, knows what is left to live on until the next payday, and spends less time on manual bookkeeping.

## Positioning

"Le contrôle d'un tableur, le confort d'une app moderne, l'intelligence d'un LLM." 100 % local: no cloud, no telemetry, data stays on the user's machine; the AI runs locally through Ollama and queries the app's own statistics API.

## Operating Context

- Cycle runs from payday to payday (configurable pay day), not calendar month.
- Core loop: import bank statement (CSV, or online sync via woob) → reconcile ("rapprocher") → categorise → watch budgets and "reste à vivre".
- Recurrences are templates that generate independent transactions; propagation to the future is an explicit choice.
- Budgets are envelopes ("seaux"); savings goals are "tirelires".
- Auto-Pilote applies automatic decisions with a reversible, traceable audit journal (undo by batch).
- Multiple profiles on one install, each optionally locked by a PIN; encrypted backups.

## Capabilities and Constraints

- Operation direction is defined strictly by "Depuis" / "Vers" (expense, income, transfer).
- Imported categories are never created automatically; the user validates them.
- UI is fully translated (fr, en; French is the primary language). The interface addresses the user with "vous".
- No server-side encryption at rest (user declined); README recommends full-disk encryption.
- PIN stays optional.

## Brand Commitments

- Name **OmniBank** and the shield logo are fixed.
- **Per-account colours** (each account keeps its own colour, reused across sidebar, filters, cards and charts) are fixed.
- **Per-profile accent colour**, chosen by the user in each profile's settings, is the accent of the interface and must keep driving it.
- The dark theme is the current default but is not a binding commitment.

## Evidence on Hand

- Demo dataset: `POST /api/setup/seed-demo` (4 accounts, 180 transactions); `demo_dataset_omnibank.csv`.
- Screenshots in `screenshots/`; bilingual user docs in `docs/fr` and `docs/en`.
- No testimonials, user counts or benchmarks exist; do not invent them.

## Product Principles

1. Accuracy first: a figure on screen must be exactly right and explain where it comes from.
2. Every automatic action is visible and reversible.
3. One app, two contexts: a dense PC workspace and a fast one-handed phone, both first-class.
4. Plain French over accounting or technical jargon.
5. The user's data never leaves their machine.
