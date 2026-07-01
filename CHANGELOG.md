# Changelog

All notable changes to this project will be documented in this file.

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
