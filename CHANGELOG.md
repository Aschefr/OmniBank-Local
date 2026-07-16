# Changelog

All notable changes to this project will be documented in this file.

## [1.0.70] - 2026-07-16

### Added
- **Global Activity & Undo System 🕓**: Added full write operation tracking (Create, Update, Delete) across transactions, accounts, categories, budgets, recurrence templates, and org users.
- **Header Undo/Redo Controls**: Added quick interactive Undo (↩) and Redo (↪) arrow buttons in the top header with real-time status updates.
- **Activity Log View**: Added a dedicated "Actions" panel displaying a paginated history of all modifications with inline action details and undo buttons.
- **Undo Toasts**: Added a temporary pop-up toast with a ↩ button to instantly reverse any successful action.

## [1.0.69] - 2026-07-16

### Added
- **Multi-Account Block Parsing 🏦**: Added automatic account segment extraction from multi-account statement exports (e.g. Crédit Agricole single-sheet exports containing concatenated account sections like deposition account, Livret A, LDD).
- **Match Confidence Index & Dropdown Fallback**: Calculates matching confidence score (0-100%) against target account. Automatically parses matching segment if confidence is high ($\ge$ 50%), and dynamically presents a manual selection dropdown for the segment to import if confidence is low (< 50%).
- **Import Modal Row Filters 🔍**: Added interactive filters ("All", "To Add", "To Reconcile") in the import verification modal to view and validate transactions by action type.

## [1.0.68] - 2026-07-16

### Added
- **Import Validation Alerts 📥**: Added timing and coherence check warnings to the bank statement import screen (for both AI and direct imports) to verify file dates against the database:
  - **Duplicate Check**: Warns if all transactions in the statement are already present in the database.
  - **Old File Warning**: Warns if the statement ends before the most recent transaction date in the database for the selected account.
  - **Gap Detection**: Detects date gaps of more than 3 days between the last transaction in the database and the oldest transaction in the imported statement.
  - **Obsolescence Alert**: Warns if the most recent transaction in the imported file is more than 7 days old compared to today's date.
  - **Account Change Check**: Detects if the selected account is changed after analysis and prompts the user to re-run the analysis for updated alerts.

## [1.0.67] - 2026-07-16

### Added
- **Notification Center 🔔**: Integrated a notification menu in the top right of the main header to keep track of system updates and financial health reports.
- **Proactive Periodic Financial Reports (AI) 🧠**: Receive automated reports written in short summaries by the Ollama AI assistant. Reports include a visual status indicator (🟢, 🟡, 🔴) calculated based on current spendable balance, regular expenses, and anomalies.
- **1-Click Deep Dive 💬**: An option within financial report notifications lets you immediately launch a pre-populated AI chat session for detailed explanations about your report.
- **Privacy & Settings ⚙️**: Periodic reports are **disabled by default**. You can enable them and choose their frequency (daily, weekly, or monthly) at any time under the **Configuration (Ollama Settings)** tab.
- **Paycheck Rejection Assistant 💸**: New correction helper modal activated when rejecting a paycheck, suggesting alternate income candidates and allowing periods to be declared as unpaid.

### Fixed
- **Background notification on chat abandonment**: Implemented disconnected/detached handling of the SSE streaming connection (`_streamDetached`). The client continues receiving the response in the background without interrupting Ollama or causing SSE abort errors, ensuring reliable automated DB saves of the response.
- **Notification on generation completion**: Create a system notification `"AI Response Available 💬"` on the server only when the generation is fully finalized and the message is persisted. Clicking this notification redirects to the correct chat session with the full answer.
- **FastAPI dependency signature errors**: Corrected internal calls to `edit_message` and `regenerate` forwarding to `send_message` to explicitly pass the `db=db` parameter, preventing `Depends object has no attribute query` errors.
- **Notification panel UX**: Clicking a notification no longer abruptly closes the dropdown menu, and changes the cursor to default pointer style once marked as read.
- **12-Month Pay History Continuity 📅**: The history modal now displays all months without "holes" using placeholder records with a definition button.
- **Logical Cycle Start Date Calculation ⏰**: Fixed date range inversion caused by placeholder records erroneously shifting the cycle start date forward.
- **Targeted Period Validation 🎯**: Declaring a month as unpaid now correctly targets the chosen period with a 0 € override instead of defaulting to the active period.

## [1.0.66] - 2026-07-14

### Added
- **Timeline (Chronogramme) view for recurrences** with interactive month grids, day status badges (reconciled/skipped/pending), click-to-skip occurrences, and details panel expansion.
- **Improved Type Indicators**: Added 3px left borders with an outward glow effect (`box-shadow`) and dynamic type detection (resolving transfers like "Economie").
- **Sticky headers** in both table and chronogramme views for seamless scrolling.
- **Smart AI Chat scroll-lock** that suspends auto-scrolling if the user scrolls up during streaming.
- **Non-destructive skip mechanism** using a dedicated `is_skipped` transaction flag instead of zeroing out amounts.
- **Sanitization Wizard Enhancements**: Closure buttons directly in groups, and filtering of inactive templates.
- **Premium Recurrence Edit Modal** with 6-occurrence preview, yearly month selection, and unified transfer fields.
- **Enhanced Transaction Modal**: Added a direct "✏️ Modifier" button to edit recurrence templates from the transaction form, updated the "🔄 Récurrences" button to navigate to, scroll to, and highlight the corresponding recurrence row, and modernized the helper hint text to match these new features.
- **New Frequencies & Badges**: Added Weekly, Quarterly, and Semi-Annually options, sorting persistence, and status column.
- **Toast Notifications**: Stackable layout with z-index fixes.

### Changed
- Settings page loads Ollama models asynchronously to prevent freeze.
- Force-refresh occurrences on template edits.

## [1.0.65] - 2026-07-14

### Added
- **Recurrence Reconciliation Progress**:
  - Added a new **Progression** column in the recurrences table showing a visual progress bar (0-100%) of reconciled transactions for each recurrence template in the selected year.
  - Features premium styling with dynamic gradient colors: a success-green gradient (`#2ecc71` to `#27ae60`) for fully reconciled items (100%), and a modern accent-purple gradient otherwise.
  - Includes a text badge showing the percentage and reconciled count details (e.g., `75% (9/12)`).
  - Integrated full column sorting support (ascending and descending) for the progression values.

### Changed
- **Last Reconciled Transaction Amount Display**:
  - Updated the "Montant" column in the main recurrences table to display the amount of the latest reconciled transaction up to the selected year, falling back to the template default amount if no transactions have been reconciled yet.

## [1.0.64] - 2026-07-13

### Added
- **Cross-Browser History Month Filter**:
  - Replaced the inconsistent native `<input type="month">` with a dynamic `<select>` dropdown populated from unique database transaction months, ensuring full compatibility on Firefox and Safari.
  - Organized month options using `<optgroup>` year headers (e.g., `2026`, `2025`) and localized month names to dramatically reduce list height and visual clutter.
  - Added month navigation buttons (◀ and ▶) next to the select field, dynamically showing/hiding themselves based on navigable directions.
  - Synchronized and translated the `filter_all_months` key in both French and English locale files, preserving UTF-8 BOM encoding.

### Fixed
- **AI Chat Visual Pipeline & Error Capturing**:
  - Centralized bubble rendering inside a unified `formatMessageContent` helper to guarantee identical visual rendering (including spinners, collapsible thoughts, and cards) in both live streaming and history loading.
  - Secured the collapsible `🧠 Phase de réflexion` details view for reasoning models by using text-based placeholders (`___THINK_START___`) during markdown parsing to prevent DOMPurify from stripping custom tags.
  - Added a `1.0s` delay to tool status SSE events in the FastAPI backend to ensure live tool execution messages (like *"Interrogation du solde..."*) remain readable instead of disappearing instantly.
  - Resolved a critical silent error bug where streaming connection failures or empty responses were overwritten by the `finally` block reloading messages. Added a `hasError` guard to prevent database reloads when an error state is visible.

## [1.0.63] - 2026-07-13

### Fixed
- **Scoped Compact Mode Rules**:
  - Scoped all compact-mode table padding, button, and select overrides specifically to the `#recurrencesTableContainer` to prevent side effects on the dashboard and history tables.

## [1.0.62] - 2026-07-13

### Fixed
- **Recurrence Expanded Compact View**:
  - Reduced padding (`4px 8px`) and font size (`12px`) on inner input fields and rows when compact mode is active.
  - Fixed specificity bug on "Sauvegarder les modifications" (Save changes) button to preserve its legible size (`12px` font size and `4px 10px` padding) in compact mode.
  - Incremented stylesheet cache-buster query parameter to `v=7` to force instant update for all users.

## [1.0.61] - 2026-07-13

### Added
- **Recurrence Column Sorting**:
  - Interactive table headers (Description, Category, Frequency, Day, Amount, Annual Total) with visual sorting indicators (▲ / ▼).
  - Dynamic ascending and descending sort order persisted on `RecurrenceView`.
- **Integrated Changelog Viewer**:
  - Replaced single release notes popup with a scrollable list of all version releases parsed directly from the local `CHANGELOG.md` file (similar to Alanbix).
  - Docker volume mount for `CHANGELOG.md` to ensure synchronized updates.

## [1.0.60] - 2026-07-12

### Added
- **Comparative Trends Refactoring**:
  - Superimposed annual curves with calendar year (Jan 1st - Dec 31st) alignment and customizable year selector.
  - Redesigned Trends layout to display the chart and comparison table side-by-side on desktop viewports (70/30 split layout) and stacked on mobile viewports.
  - Compacted the comparison table by removing Min/Max columns to fit the side-by-side layout perfectly.
  - Introduced dynamic viewport height calculations (`calc(100vh - 330px)` / `calc(100vh - 400px)`) to fit Trends elements precisely without body or container scrollbars.
  - Interactivity & focus: clicking a year highlights its curve and dims other years, while updating stats cards dynamically.
  - Smooth X-axis zooming & panning using `chartjs-plugin-zoom` CDN, with a restyled "Reset Zoom" button.
  - Modern iOS-style toggle switch for the "Superpose years" checkbox.
- **Premium Recurrences View Redesign**:
  - Introduced 4 global stats cards (planned annual total, monthly average, active recurrence count, and reconciliation rate) at the top of the view.
  - Added a "Total annuel" column in the recurrence table showing the sum of actual operations for the selected year for each template.
  - Styled frequency columns using beautiful colored badges (blue for monthly, purple for yearly, green for bi-monthly).
  - Interactive chevron rotations (0 to 90 degrees) using smooth CSS transitions when unfolding recurrence instances.
- **System Polish**:
  - Implemented script load cache-busting version tags in `index.html`.

### Fixed
- Fixed table alignment on Trends page by wrapping blurred values in `<span>` tags rather than applying `privacy-blur` to `<td>` tags.
- Fixed year filtering initialization bug where unchecking a year initially failed to update the chart/table.
- Fixed SQLite database operational errors (disk I/O error) on WSL2/Docker volume mounts on Windows/NTFS by wrapping pragmas in robust exception handlers and falling back to DELETE rollback journal mode.
- Removed outdated and irrelevant "Other months" compare option for a cleaner, unified workspace.

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
