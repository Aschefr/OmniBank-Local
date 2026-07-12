# Changelog

All notable changes to this project will be documented in this file.

## [1.0.59] - 2026-07-12

### Added
- Chat IA Premium: Double-column layout with sidebar for conversation sessions and main chat window.
- Context Compaction: AI context is dynamically compressed under a configurable threshold to fit in context window.
- Conversation Session persistence: selected conversation session and its precise scroll position are remembered (via sessionStorage) across tab switches.
- Added transaction duplication feature: duplicate any existing transaction with a single click (📋 button) pre-filling the entry form with today's date.
- Added "16K" quick setting option in config context size panel.
- System message endpoint `POST /api/chat/sessions/{id}/system-message` to add feedback messages without triggering AI generations.

### Fixed
- Fixed UI overlap bugs by moving message action buttons from absolute positioning to inline block elements inside bubbles.
- Fixed empty stream bug: chat UI now displays an explicit error message instead of failing silently when Ollama doesn't return content.
- Fixed stream delivery on non-tool routes: response is stream-chunked in all paths for a smooth rendering experience.
- Fixed XSS vulnerability: user message texts are now properly escaped with HTML entities.
- Fixed token usage indicator: correctly initialises based on the server's real Ollama config instead of defaulting to 4096.
- Fixed loop bug in session creation when no sessions exist.
- Fixed bubble edit size & look-and-feel: inline bubble text editor matches the exact width of the message bubble and uses a cleaner theme-integrated border.

## [1.0.58] - 2026-07-05

### Added
- English localization: translated 40+ remaining French-only keys in `en.json` (system prompts, category manager labels, UI fallbacks). Community contribution by [@Lloir](https://github.com/Lloir) (PR #1).
- Dynamic `<html lang>` attribute: now automatically reflects the user's selected language instead of being hardcoded.

### Fixed
- Fixed Docker image missing `/app/static` directory, causing `FileNotFoundError` crash on standalone deployments (e.g. Unraid) that don't use volume mounts.
- Reverted AI chat prompts (`chat.py`) to use French locale — the PR had hardcoded English, breaking the AI assistant for French-speaking users.

### Improved
- Budget envelope creation now scrolls to and highlights the new card with a glowing accent animation for visual confirmation.
- Added `.idea/`, `.vscode/` and other IDE config directories to `.gitignore` to prevent future contributors from accidentally committing editor settings.
## [1.0.57] - 2026-07-01

### Fixed
- Fixed implicit account pre-selection in the transaction entry form: browsers were silently pre-selecting the first account in the listbox, causing the inferred transaction type to default to `expense_var` instead of `neutral`, which incorrectly displayed variable expense categories before any account was chosen.
- Fixed SQLite `database is locked` errors (HTTP 500) occurring when multiple API endpoints are called concurrently on page load. Configured a 30-second busy timeout in SQLAlchemy connection args.
- Fixed transfer transactions showing an empty category dropdown. The "Compte vers compte" category was stored with type `neutral` instead of `transfer`. Added schema migration v5 to automatically reclassify all `neutral` categories as `transfer` on startup, ensuring correct behaviour for all users without manual intervention.
- Fixed "Neutre" category group in the Category Manager incorrectly appearing with transactions in the Synthesis view due to wrong category type assignment.

### Changed
- Categories of type `neutral` and `transfer` are now strictly separate in the transaction entry form. Each transaction type only shows its own matching categories.

## [1.0.56] - 2026-06-25

### Added
- Added manual `is_salary` flag to transactions (controllable via checkbox on income transaction edits).
- Added quick settings configurable pay category filter and minimum paycheck percentage threshold.
- Added a "Reject" (❌) action directly in the paycheck history modal (`payHistoryModal`) to quickly exclude false-positive paycheck detections.
- Added "piggy bank overflow" visual logic: when rest-to-live becomes negative, the amount color-codes to orange (consuming savings) or red (savings fully consumed). Savings progress bars in the sidebar, budget cards, savings summaries, and the budget details modal display dual-fill bars showing both theoretical and effective savings levels along with a negative badge showing the temporarily borrowed amount.
- Added date adjustment shortcuts (`◀` / `▶`), a today button (`📅`), and a clear button (`✕` for reconciliation date) positioned and distributed evenly directly below the date input fields in the transaction entry modal.
- Added dynamic button label translation (renaming "Annuler" to "Fermer") when "Garder ouvert" is active, persisted the keep-open toggle setting in local storage, and preserved all entered form fields upon saving when keep-open is on.
- Improved modal styling by expanding width to 580px and disabling flex-wrap on the footer to keep "Fermer" and "Enregistrer" buttons locked in place when the undo button appears.

### Changed
- Improved paycheck detection algorithm to ignore non-salary incomes using the new configurable threshold (defaults to 30% of average historical paycheck) and optional category filter, preventing small income transactions from advancing the pay period.
- Enhanced backup restoration process to automatically re-run database schema migrations (`init_db()`), preventing backend 500 errors when restoring legacy backups lacking newly introduced columns like `is_salary`.

## [1.0.55] - 2026-06-21

### Changed
- Optimized backend database query performance:
  - Restricted transaction loading in budget status calculations to only search within active budget date ranges (e.g. current year/month/custom ranges) rather than retrieving the entire history.
  - Optimized account balance queries to select only necessary columns (`amount`, `from_account_id`, `to_account_id`) to bypass expensive SQLAlchemy object hydration overhead.
  - Optimized paycheck prediction queries by fetching only required columns.
  - Resulted in a 5x to 15x speedup for dashboard stats and accounts endpoints, dropping reload times to under 100ms.

## [1.0.54] - 2026-06-21

### Changed
- Optimized Nginx configuration (`nginx.conf`) for Docker image / Unraid setups:
  - Enabled HTTP Keep-Alive for API routes by dynamically mapping the connection upgrade header.
  - Disabled Nginx proxy buffering (`proxy_buffering off;`) to avoid writing large API responses to disk, resolving major UI latency issues on Unraid/FUSE filesystems.
  - Enabled Gzip compression for proxied dynamic backend responses (`gzip_proxied any;`) to reduce bandwidth and speed up page load times.
