# Changelog

All notable changes to this project will be documented in this file.

## [1.0.87] - 2026-08-19

### Improved & Fixed
- **Comprehensive Bilingual Internationalization (FR / EN) 🌐**:
  - Fully translated bank synchronization header badges (encrypted status, vault countdown with dynamic day units, auto-sync widget).
  - Localized bank connection error fallbacks, error reporting action buttons (`Copy`, `Issue`, `Diag`), and account mapping modal.
  - Eliminated all remaining hardcoded UI strings, placeholders, and tooltips across diagnostics, smart rules, settings, recurrences, and budgets.
  - Synchronized over 110 new translation keys with strict parity in `fr.json` and `en.json` (UTF-8-SIG).
- **AI Assistant Tool Badges & Descriptive Tooltips 🤖**:
  - Replaced technical function names (`tool_get_financial_summary`, `tool_forecast_balances_history`, etc.) on AI tool usage badges with user-friendly translated labels.
  - Added descriptive hover tooltips explaining the exact action taken by the AI assistant for each tool.
  - Updated tool emoji mapping across all 32 read and write assistant actions.

## [1.0.86] - 2026-08-19

### Added & Improved
- **Code Audit & Backend Hardening 🛡️**:
  - Scoped pending bank synchronization cache management (`_PENDING_SYNC_DATA`) strictly per profile ID to eliminate race conditions.
  - Converted maintenance queries in `maintenance.py` to parameterized SQLAlchemy ORM queries.
  - Eliminated bare `except:` clauses across `finance_engine.py`, `csv_parser.py`, `csv_manager.py`, `ai_helpers.py`, and `chat.py`.
  - Enforced single-responsibility and caller-controlled database transaction atomicity in `CredentialVault`.
  - Added Linux environment marker for `uvloop` dependency in `requirements.txt`.
- **Bank Synchronization Error Handling & Diagnostics 🩺**:
  - Enhanced Woob error translation (`clean_error_message`) with explicit detection of `FormNotFound`, `BrowserUnavailable`, `AppValidation`, and `ActionNeeded`.
  - Full traceback logging for synchronization exceptions.
  - Persistent error reporting and action buttons (`📋 Copier`, `🐙 Issue`, `⚙️ Diag`) on connection cards surviving page reloads (F5).
- **Diagnostics Navigation & Visual Highlighting 🎯**:
  - Added `window.app.navigateToDiagnostics()` helper for all Diag triggers across the app.
  - Smooth auto-scroll with glowing pulse highlight animation (`sectionHighlightPulse`) directly centering on the Diagnostics & Incident Report section in Settings.
- **UI Animation Direction Polish 🔄**:
  - Added counter-clockwise spinning animation (`spin-reverse`) matching the natural arrow direction of badge sync icons.

## [1.0.85] - 2026-08-18

### Added & Improved
- **Bank Synchronization & 2FA Account Discovery 🏦**:
  - Interactive 2FA / SCA authentication stream during account association modal (supporting BoursoBank mobile validation and SMS OTP).
  - Strict cryptographic and profile isolation for remote accounts cache (`omnibank_remote_accounts_{profile}_{backend}_{id}`) preventing cross-institution cache display.
  - Automatic cache purge on connection deletion or new connection creation, enforcing live account fetching from the bank.
  - Restored full dropdown selection for all 39 Crédit Agricole regional branches.
  - Integrated 1-click diagnostic buttons in error banners (Configuration & Diagnostics, Copy Bug Report, Create GitHub Issue, Retry).
  - Fixed background auto-sync scheduler loop on unmapped bank connections.
- **Smart Labels & Original Bank Descriptions 🏷️**:
  - Retained and displayed original raw bank descriptions with bank badge (`🏛️ <raw_description> 💡`) under editable description fields in review modals.
  - Proactive smart label batch resolution during synchronization review.
- **Account Balance Realignment & Retro-Adjustment ⚖️**:
  - Added intelligent **Balance Realignment** assistant in the account edit modal to automatically compute starting balance from current actual bank balance.
  - Automatic retro-calculation of initial balance on first batch import of newly connected bank accounts to prevent double-counting historical transactions.
- **Secure Vault Management 🔐**:
  - Added secure vault reset endpoint and interactive reset link on the master password modal with clear confirmation dialogs.
- **Dynamic Multilingual Notifications & UI Polish 🌐**:
  - Dynamic on-the-fly bilingual translation (FR/EN) for bank sync, success, up-to-date, and error notifications matching the user's active language.
  - Fixed listbox scrollbars (`overflow-y: auto`) and visibility of 4+ accounts in transaction forms.
  - Instant live removal of validated ghost operations without requiring a manual page refresh.

## [1.0.84] - 2026-08-18

### Added & Improved
- **Smart Label Engine & Auto-Categorization 🏷️**:
  - Automatically translates cryptic bank labels (e.g. `CB CARREFOUR 74210`, `PRLV SEPA SPB`) into clean merchant names (`Carrefour`, `Assurance Téléphone`) and auto-assigns matching categories based on your spending history.
  - Automatically learns new merchant names and habits as you validate or edit transactions.
  - New **Règles de correspondances** hub in Settings to view, search, add, edit, or delete label rules.
  - 1-click inline status toggle between **Mapped** (`🏷️`) and **Ignored** (`🚫`) without losing original custom names and categories.
  - Optimized table layout and column widths preventing truncated header labels.
- **UI & Dark Mode Improvements 🎨**:
  - Fixed chart gridlines visibility in light theme on Simulator and Trends charts with clear 0 € baseline highlighting.
  - Harmonized badge height and alignment in Bank Sync header.
  - Modern dark scrollbars and native `color-scheme: dark` integration for modal dialogs and scrollable panels.
- **Visual Online Ghost Rows 👻**:
  - Newly detected online bank transactions appear immediately as interactive ghost cards above Dashboard, Operations, and Overview views.
  - 1-click inline actions to validate, edit, or dismiss unrecorded transactions directly.
  - Bulk validation button (*Valider les nouvelles opérations*) to record all pending transactions in one go.
- **Universal Bank Synchronization (Woob) 🏦**:
  - Direct local sync with 96+ French banking institutions with 100% offline security (zero cloud, zero data tracking).
  - Background auto-sync scheduler with in-app notification summaries and interactive mobile/SMS 2FA validation support.
  - Automatic detection of internal mirror transfers between your accounts to avoid duplicates.
- **Multi-Profile Vault Isolation 🔐**:
  - Strict cryptographic and session isolation: each profile now manages its own encrypted vault and master password with zero cross-profile leakage.
- **1-Click Anonymized Diagnostics & Bug Reporter 🩺**:
  - New diagnostic hub in Settings collecting anonymized logs and error traces with 1-click export to GitHub Issues.
- **Accounts Table Dual Balances & Live Subtotals 💳**:
  - Clear side-by-side display of initial balance and live current balance for every account.
  - Real-time cumulative balance subtotals per category (*Disponibilités actuelles*, *Épargne totale*, *Capital restant dû*).
- **Notification Center Improvements 🔔**:
  - Added a 1-click **Tout supprimer** button in the notification popover with double-click confirmation.

## [1.0.83] - 2026-08-15

### Added & Improved
- **Financial Project & What-If Scenario Simulator 🔮 (Feature 1.C)**:
  - **100% Secure Sandbox**: Simulate major financial projects (vehicle purchase, home renovations, mortgage loan, sabbatical leave, cost-of-living adjustments) over customizable horizons (6 to 36 months) without altering or polluting real database transactions.
  - **Real-Time Prudence & Realism Slider (Curseur de Prudence) 🛡️**: Seamless interactive slider allowing you to blend your real historical past cash flows (`🎯 100% Réel`) with conservative stress-test assumptions (`🛡️ Stress-test`) at 60 FPS with instant curve morphing.
  - **Direct Clickable Shortcuts & Reset Badges**: Click directly on the extremity labels (`🎯 100% Réel`, `🛡️ Stress-test`, `-100%`, `+20%`) or value badges (`⚖️ 50% Mix`, `0% Normal`) to snap sliders instantly without navigating menus.
  - **Budget Effort Slider & Monthly Impact ⚡**: Dynamically adjust your variable spending from $-100\%$ to $+20\%$ with real-time feedback displaying the exact monthly saving in €/month.
  - **Smart Break-Even Advisor ("Conseiller d'Équilibre") 💡**: Automatically calculates the exact effort needed to prevent an overdraft during major projects, offering a one-click button to apply the optimal variable expense reduction.
  - **Dual-Curve Interactive Projection**: Visualise your simulated financial trajectory with Chart.js compared against your baseline trajectory, including zero-threshold overdraft markers and lowest cash points.
  - **Instant Scenario Builder & Live Toggles**: Add, edit, or duplicate custom simulated events (one-off expenses, lump-sum incomes, monthly recurring loans, relative percentage variations) with instant toggle switches for real-time recalculations.
  - **Configurable Reference Income Options**: Choose how your regular income is projected in the baseline trajectory — Auto-estimated 12-month average, Historical N-1 month-by-month seasonality (including 13th month & bonuses), Custom fixed amount (€/month), or Disabled (declared recurrences only).
  - **Ready-to-Use Presets**: Quick templates with pre-configured parameters for Auto Loans, Home Renovations, Sabbatical Leaves, and Real Estate projects.
  - **Polished Mobile & Desktop Ergonomics 📱**: Refined mobile viewport with comfortable 14px horizontal margins (preventing text edge-clipping), widened comfortable sliders, and responsive 4-card KPI grid.
  - **Full Multilingual & Localized Presets**: Complete bilingual (FR/EN) support across all simulator components — including dynamic month labels on curves and tables, localized horizon selectors, overdraft badges, and preset templates that generate scenario descriptions and event labels in the user's active language.
  - **Optional Feature Toggle in Settings**: Easily enable or disable the Simulator module from the *Fonctionnalités Optionnelles* section in Settings to customize your navigation bar.
  - **Comprehensive Monthly Breakdown**: Detailed month-by-month table highlighting starting balances, baseline cash flows, simulated impacts, final balances, and critical overdraft alerts.




- **Enhanced AI Assistant Experience & Flawless Formatting 💬**:
  - **Clean & Readable Responses**: The AI assistant now automatically cleans and formats all responses into elegant Markdown, preventing any raw data blocks or technical JSON payloads from cluttering your chat stream.
  - **Polished Financial Insights**: The *"Approfondir avec l'IA"* feature now delivers crystal-clear, structured analytical insights without raw text noise.
  - **Pristine Responsive Chat Interface**: Re-engineered the chat layout to fit your screen seamlessly with zero horizontal overflow, preventing conversation bubbles or sidebars from stretching out of bounds.

- **Direct Quick Actions on Overview Dashboard ⚡**:
  - **Complete Action Suite**: The *Opérations à rapprocher* list on the Overview page now features the full suite of quick actions directly on each row: **✓ Rapprocher** (Instant reconcile), **⏭️ Passer** (Skip occurrence for recurrences), **📋 Dupliquer** (Clone operation), **✏️ Modifier** (Quick edit modal), and **✕ Supprimer** (Delete with confirmation and undo toast).

- **Faster, Ultra-Responsive App Performance ⚡**:

  - **Snappier Page Transitions**: Completely streamlined internal modules across Chat, Settings, and Recurrences for faster loading, silky-smooth modal popups, and improved battery/CPU efficiency.
  - **Smoother Conversation Flow**: Optimized conversation history handling and context compression, ensuring discussions with the AI assistant stay light, snappy, and responsive.

- **Modernized Core & Reliability Boost 🚀**:
  - **Zero-Deprecation Architecture**: Modernized backend API data validation schemas with the latest Pydantic v2 engine (`model_dump()`, `@field_validator`), delivering faster payload parsing and eliminating internal deprecation warnings.
  - **Modernized Application Lifecycle**: Transitioned API startup and background processes to FastAPI's streamlined `lifespan` manager, ensuring rock-solid initializations of background auto-backups, network discovery, and graceful shutdowns.
  - **Rock-Solid Test Suite (100% Green)**: Hardened test isolation across all functional domains (accounts, multi-profile transfers, AI financial reports, smart recurrences, currency conversion, and simulator) with 52/52 tests passing.
  - **Standardized UTC Time Stamps**: Unified all internal transaction and audit timestamps to modern timezone-aware standards for flawless cross-session accuracy.


## [1.0.82] - 2026-08-07

### Fixed & Improved
- **Global Undo/Redo Support for Subscription Closure ↩️**:
  - **Full Reversal Integration**: Integrated `CLOSE` and `REOPEN` recurrence actions into the global Undo/Redo history engine (`history_service.py`).
  - **Automatic Recurrence Regeneration & Cleanup**: Undoing a subscription closure restores `is_closed = False` and automatically regenerates future recurring instances, while redoing a closure cleans up future unreconciled instances.
  - **Conflict Safety**: Added `CLOSE` and `REOPEN` action types to dependency conflict checking (`check_undo_safety`).

## [1.0.81] - 2026-08-07

### Added & Improved
- **Clean Mid-Year Subscription Closure & Reopening 🛑**:
  - **Dedicated Closure Modal**: Easily close active subscriptions mid-year with flexible cutoff dates (*Today*, *End of current month*, or *Custom date*). Future unreconciled instances after the cutoff date are cleanly purged, while past accounting records and reconciled transactions remain intact.
  - **In-Line Confirmation**: Reopening closed subscriptions now requires explicit in-line modal confirmation (`showInlineConfirm`), preventing accidental resume of recurring instances.

- **Unified Recurrence Action Menu Layout 🎨**:
  - **Streamlined Action Placement**: Action buttons (`✏️`, `🛑`/`🔓`, `🗑️`) are now cleanly unified in the top-right header of the expanded details drawer (*"Détails des opérations de l'année"*), eliminating duplicate buttons from main table rows.
  - **Pristine Timeline View**: Kept the Chronogramme (Gantt) 12-month visual grid clean, uncluttered, and perfectly aligned with zero layout distortion.

- **Data Sovereignty & Privacy Safeguards 🛡️**:
  - **Untracked Sensitive Profile Data**: Removed `data/profiles.json` and runtime profile directories from Git tracking (`git rm --cached`).
  - **Repository Protection**: Added strict `.gitignore` patterns and provided an anonymized template file (`data/profiles.json.example`).


## [1.0.80] - 2026-08-07

### Added & Improved
- **Ultra-Responsive Interface & Speed Boost ⚡**:
  - **Instant Visual Feedback**: Enjoy immediate responsiveness when creating, editing, deleting, or reconciling transactions. Modals close and lists update instantly without frustrating page lag.
  - **Seamless Background Refresh**: Financial calculations and updates now process in the background without freezing or interrupting your workflow.

- **Refined Overview & Display Ergonomics 🎨**:
  - **Sleek Summary Cards**: Realigned key indicator cards ("Solde", "Reste à vivre", "Projection", "Risque découvert") to display large monetary amounts cleanly without text wrapping, line overlaps, or squishing.
  - **Harmonized Table Headers**: Restored complete, translated table headers (`Compte`, `Montant`, `Actions`) across all overview lists.

- **Seamless Profile & PIN Security 🔒**:
  - **Reliable Security Setup**: Fixed an issue where clicking "Configurer un PIN" or "Modifier PIN" inside profile settings failed to open. Setting up or updating security PINs now opens smoothly every time.

- **Analytics View Internal Transfer Visibility 🔁**:
  - **Unfiltered Internal Transfer Tables**: Internal transfers (`type == 'transfer'`) now remain visible in their dedicated summary tables on the Analytics ("Synthèse") page even when viewing "All Accounts", allowing users to track annual transfer volumes while keeping global Net Income calculations (`Income - Expenses`) completely neutral.

- **Dynamic Budget Envelopes UI Refresh ⚡**:
  - **Instant UI Updates**: Fixed an issue where validating AI budget proposals or executing bulk budget cleanup required a manual page refresh (F5) to update the UI. Budgets now re-render dynamically across all cards immediately upon confirmation.


### Added & Improved
- **Comprehensive Multi-Profile Backup Protection 🛡️**:
  - **Full All-Profiles Auto-Backups**: Automatic background backups now protect all your master profiles in a single archive (instead of backing up only the currently active profile), ensuring no profile data is ever missed.
  - **Clear Archive Naming**: Automatic backup files are now explicitly named `auto_backup_all_profiles_YYYYMMDD_HHMMSS.zip` so you can immediately recognize complete multi-profile archives.

- **Smart Restore Safeguards & Security 🔒**:
  - **Accidental Mis-Restore Prevention**: OmniBank now intelligently detects archive types during restoration. Attempting to restore a single-profile backup globally (or a global backup into a single profile) is blocked with clear, user-friendly instructions, protecting your financial records from accidental corruption.
  - **Archive Security Validation**: Integrated path-traversal safeguards during zip extraction to guarantee safe restoration from external archives.

- **Windows & Docker Path Resolution 📂**:
  - **Exact Local Explorer Path**: The "Copy path" button for backup storage locations now copies the real Windows host folder path (e.g. `D:\...\data\backups`) instead of container-internal paths (`/app/data/backups`), allowing you to paste it directly into Windows File Explorer.

- **UI & Multi-Language Polish ✨**:
  - **Custom Confirmation Modals**: Replaced system alert popups with native OmniBank dark-mode confirmation dialogs for global restores.
  - **Full i18n Translation**: Added complete English and French translations for all backup, restore, and error notifications.

## [1.0.78] - 2026-08-05

### Added & Improved
- **New Overview View ("Vue d'ensemble") 👀**:
  - **All-in-One Financial Dashboard**: Introduced a modern, streamlined full-screen overview designed to give you an instant 360° summary of your personal finances.
  - **Hero Financial KPIs**: Display total net worth, spendable *Reste à Vivre* (left-to-live), upcoming salary date, and proactive overdraft warnings at the top of your dashboard.
  - **Central Pending Operations Table**: Easily review, filter, search, and reconcile all pending operations from a single central table without switching screens.
  - **6-Month Financial Trend**: Interactive visual chart tracking your balance and spending trends over the past 6 months.
  - **Budgets & Savings Snapshot**: At-a-glance status indicators for your active budget envelopes and savings progress, with direct quick-links to detailed views.

- **Financial Trends Accuracy & Multi-Mode Visualizations 📊**:
  - **Directional Internal Transfer Accounting**: Overhauled `/api/stats/categories_by_month` calculation logic to handle internal transfers and recurring savings deposits accurately (+ / - signed directionally for individual accounts; net zero for "All accounts").
  - **Savings Account Accuracy**: Savings deposits (e.g. transfers to Livret A) now properly reflect as incoming deposits rather than false fixed expenses.
  - **4 Interactive Chart Modes**: Switch seamlessly between **Sorties / Expenses**, **Recettes vs Sorties / Income vs Expenses**, **Bilan mensuel / Monthly Cash Flow**, and **Solde historique / Balance History**.
  - **Seamless View Propagation**: Clicking "Voir tout →" from the Overview smoothly transitions to the full Trends view while carrying over your active account filter and chart mode.
  - **Smooth Pan & Pinch-Zoom**: Added smooth animated pan/drag controls (`Chart.js` + `Hammer.js`) for natural chart navigation on desktop and mobile touchscreens.

- **UX, Mobile i18n & Interface Polish 📱✨**:
  - **Dynamic Mobile Language Selector**: Added a dynamic language dropdown selector in the mobile burger menu that detects available `.json` translation files automatically.
  - **Closed Accounts Filter**: Automatically hides closed accounts (`is_closed == true`) from account selection dropdowns across the Overview and Trends views.
  - **Clear Financial Wording**: Renamed ambiguous "Solde net" to **"Bilan mensuel"** (*Monthly cash flow*) across buttons, tooltips, legends, and stat cards to prevent confusion with bank account balances.
  - **Visual Alert Indicators for Past Unreconciled Transactions ⏳**: Added subtle amber alert indicators for past unreconciled operations across Overview, Timeline, and Operations History.
  - **UI Icon Cleanup**: Removed duplicate button icons on primary action buttons for a clean, professional aesthetic.

## [1.0.77] - 2026-08-03

### Added & Improved
- **Smarter AI Health Reports & Financial Forecasts 🤖📈**:
  - **Exceptional Expense Detection**: Major one-time purchases (like buying a car or major appliance) are now automatically detected and excluded from daily spend projections, preventing false overdraft warnings after large planned expenses.
  - **Real-World Pending Expense Tracking**: Pending transactions and scheduled bills are now factored into your 30-day forecast to ensure short-term balance projections match your actual budget.
  - **Reste à Vivre & Savings Cushion**: Proactive AI reports now prioritize your *Reste à Vivre* (left to live) indicator while recognizing piggy bank savings as an emergency safety net before any real bank overdraft occurs.
  - **Clean Report Formatting & AI Chat Awareness**: Cleaned up AI report rendering in notifications and improved AI chat responses to contextualize large purchases intelligently without panicky budget advice.

- **Inter-Profile Transfers & Approval Workflow ↔**:
  - **Direct Transfers Between Profiles**: Effortlessly transfer money between accounts belonging to different profiles (e.g., partners, family members, or shared activities).
  - **Approval Queue**: Incoming transfers wait for your explicit confirmation (*Accept* or *Decline*) before impacting your balance or transaction history, keeping full control in your hands.
  - **Notification Center Integration**: Manage pending transfers directly from the notification bell (🔔) with instant one-click actions or open a dedicated details view.
  - **Seamless Dashboard Updates**: Accepting a transfer instantly adds the operation to your dashboard, auto-scrolls to the new row, and highlights it with a clear green animation without needing a page refresh.

- **Smart Multi-Currency Conversions 💱**:
  - **Automatic Currency Conversion**: Sending money between profiles with different currencies (e.g., USD ➡️ EUR) automatically converts the amount to the recipient's currency using standard exchange rates.
  - **Original Currency Badges**: View both the converted amount and original sent amount (e.g., `🌐 $50.00 USD`) across notifications, pending details, and transaction tables for total transparency.

- **Mobile Viewport Actions Card View 📱**:
  - **Responsive Action Cards**: Transformed the truncated 6-column data table into responsive single-card components (`.mobile-card-table`) on mobile viewports ($\le 768\text{px}$).
  - **Unclipped Details & Touch Controls**: Expanded full action details and formatted dates with clean multi-line layouts and touch-friendly 36px action buttons (`🔍 Details` & `↩ Undo`).

## [1.0.76] - 2026-08-03

### Added & Improved
- **100% Mobile Viewport Compatibility 📱**:
  - **Single-Line Compact Header**: Streamlined top header bar into a single-row 52px layout on mobile ($\le 768\text{px}$) with hamburger menu ☰, centered logo 🏦, and profile badge + notification bell 🔔.
  - **Opaque Sticky Filter Bars**: Enhanced filter headers across History and Timeline views with solid background surfaces and drop shadows (`box-shadow`), eliminating card bleed during page scrolling.
  - **Fixed History Totals Footer**: Repositioned operations summary metrics (`OPÉRATIONS`, `DÉPENSES`, `RECETTES`, `TOTAL AFFICHIÉ`) into a fixed bottom bar anchored to the viewport in a compact 2×2 grid layout.
  - **Recurrences Mobile Card View**: Transformed the 11-column data table into responsive single-row card components (`.mobile-card-table`) with custom `data-label` cell formatting and an overflow-free scroll container (`.table-responsive`).
  - **Full-Width & Compact Recurrence Details**: Expanded unfolded template occurrence cards (`.rec-details-cell`) across 100% of mobile card width with a 320px scrollable container (`.rec-instances-list`).
  - **Reactive Detail Toggle (`toggleRow`)**: Fixed CSS specificity issue allowing expanded recurrence detail cards to toggle reactively on subsequent clicks.
- **Transaction Edit Modal Polish & Ergonomics 🛠️**:
  - **Fixed Footer Overflow**: Resolved primary save button truncation when *Keep Open*, *Clear Fields*, and *Delete Transaction* options are active.
  - **Action Label & Layout Optimization**: Shortened primary action button text to **"Enregistrer"** (`Save` in EN), expanded modal container width to `660px` max, and added responsive `flex-wrap` layout to fit all screen sizes smoothly.

## [1.0.75] - 2026-08-01

### Added & Improved
- **Multi-Master Profiles 👥**: Create and seamlessly switch between multiple completely isolated financial workspaces (Personal, Business, Association) on a single installation with 100% offline data sovereignty.
- **Custom Accent Colors & Live Preview 🎨**: Personalize each profile with custom theme accent colors, featuring real-time live preview without darkening the background interface.
- **Rich Profile Customization & Emoji Picker ⚙️**: Choose custom icons/emojis with an integrated emoji selector, configure main currency, default pay cycle day, date format, and export individual profile backups.
- **Instant Dynamic Updates ⚡**: Profile settings (pay day, currency, date formatting) apply immediately across the entire dashboard without requiring page reloads (F5).
- **Automatic Backup Settings Sync 🔄**: Restoring a database backup automatically synchronizes profile settings with your restored financial data.
- **Enhanced Security & Auto-Lock 🔒**: Protect individual profiles with an optional PIN code, auto-lock inactive sessions, and validate inputs using the `Enter` key.
- **Full Bilingual Support (EN / FR) 🌐**: Complete English and French localization across all profile configuration panels and cards.
- **Profile-Scoped & Global Backups 📦**: Export or restore individual master profiles or full application multi-profile backups in one click.

## [1.0.74] - 2026-07-30

### Added & Improved
- **Trends View Toolbar & Database Persistence 📈**:
  - Relocated **Alignment** dropdown ("Rolling" / "Calendar year") inline next to the "Superimpose years" switch in the header bar, keeping it permanently active across single-curve and superimposed modes.
  - Saved user view settings (`trends_superimpose`, `trends_alignment_type`, `trends_timeframe_months`, `trends_account_id`) directly in SQLite database via `/api/config` for instant cross-browser preference synchronization.
- **Budgets & Envelopes Refactoring 💼**:
  - Thread-safe AI status management in `budget_ai_service.py` via `threading.Lock` and non-blocking asynchronous calls to Ollama.
  - Unique DB index constraint on `Budget(name, envelope_type)` and check constraint `chk_budget_envelope_type`.
  - Automatic cleanup of orphan account IDs in `Budget.account_ids` when deleting an account (`accounts.py`).
  - Fragile closure pattern fix in `budget_service.py` (`_match_account` using default argument scope capture).
  - Externalization of inline styles from `budgets_render.js` to semantic CSS classes (`.bv-*`) in `style.css` (~120+ inline styles migrated).

## [1.0.73] - 2026-07-27

### Added
- **Transaction Form – Improved "Keep Open" mode 📋**:
  - New **"Clear fields"** badge-button (visible only when "Keep Open" is active): automatically clears the description, amount, category, check slip, attachments and budget fields after each save. State is persisted in `localStorage` independently from the "Keep Open" toggle.
  - "Keep Open" mode now also works in **edit mode**: the modal stays open after updating an existing transaction.
  - The **"Remove last entry"** button now appears below the toggles (second row) and is only shown after the first save in create mode.
  - In **edit mode**, that same button becomes **"🗑️ Delete transaction"** with an inline 2-click confirmation (first click → red alert state + auto-reset after 3 s, second click → delete + close modal).
- **Global button text centering 🎨**: added `display:inline-flex; align-items:center; justify-content:center` to the `.btn` class for perfect centering in all contexts (fixed height, asymmetric padding, etc.).

### Fixed & Improved
- **Accent-insensitive search 🔍**:
  - Search fields now ignore accents across the entire application (e.g. typing `peage` finds `Péage`).
  - Affected files: transaction add/edit form (`form.js`), category manager view (`categories_manager.js`), and multi-select component (`multi-select.js`).
  - Consistent use of `cleanStringForSearch()` (NFD normalisation + diacritic removal), already in place in the recurrence manager.
- **Transaction form footer**: refactored layout into a single row (compact toggles on the left, action buttons on the right with `white-space:nowrap`) — the "Save transaction" button is no longer clipped.
- **"Clear fields" state preserved**: toggling "Keep Open" from Off → On now restores the previous state of the "Clear fields" badge instead of resetting it.

## [1.0.72] - 2026-07-26

### Added
- **Analytics & PDF Export - Inactive Categories & Types 📊**:
  - Added "Show/Hide inactive categories" toggle per transaction type in the Synthèse view.
  - Added option to include inactive categories and completely inactive transaction types in PDF exports with full annual historical totals.
  - Exposed `inactive_types` data endpoint in backend stats API.

### Fixed & Improved
- **Analytics Summary Table Accuracy 🧮**:
  - Fixed annual column total sums so historical totals include all active/inactive categories across all years instead of truncating based on the filtered period.
- **PDF Export Rendering 📄**:
  - Removed container `max-height` and `overflow` CSS bounds in print mode to prevent table clipping.
  - Corrected `no-print` DOM filtering scope to preserve inactive rows and inactive type tables when requested.
  - Improved layout spacing between type tables in printed reports.

## [1.0.71] - 2026-07-25

### Added
- **Multi-Currency Support 💱**:
  - Real-time currency conversions, customizable exchange rates, multi-currency transaction/account support, and original currency badges.
- **Advanced PDF Export Module 📄**:
  - Modular section cards, dynamic page breaks, parameter persistence, and custom date range selection in exports.
- **AI Budget Assistant 🧠**:
  - Improved suggestions from the AI assistant
- **Budget Load Speed & Performance Optimizations ⚡**:
  - Added SQLite indexes on `Transaction.budget_id` and composite `(category, date_operation)`.
  - Optimized Python $O(B \times T)$ nested loop with $O(1)$ category lookup dictionary (`txs_by_cat`).
  - API endpoint consolidation via `period_filter=all` single-query status batching and embedded `savings_overflow` inside `/api/budgets/capacity`.
  - Frontend parallelized category loading (`Promise.all`), eliminated `/api/stats/dashboard` dependency from Budgets view, and eliminated double DOM rendering.

### Fixed & Improved
- **AI Budget Wizard & Simulator UX 🧠**:
  - Preserved yearly/monthly period settings during envelope creation.
  - Smoothed historical estimations and enabled instant slider reactivity.
  - Graceful Ollama AI connection error handling, scale displays, and salary badges.
- **UI & i18n 🌐**:
  - Fixed toggle switch alignment and knob centering styling.
  - Improved wording and i18n keys for budget capacity panel.
  - Added missing translation keys for date selectors in exports.

## [1.0.70] - 2026-07-23

### Added
- **Full Budgets Module Refactor 💡**: Refactored and modularized frontend architecture (`budgets_core`, `budgets_render`, `budgets_ai`, `budgets_modals`) and backend (`budget_service.py`) for improved maintainability and faster rendering.
- **Advanced AI Budget Simulator 🧠**:
  - Humanized and explanatory AI status pipeline with automatic Ollama retries and fallback mechanisms.
  - Granular thematic envelope breakdowns and automatic budget capacity calculation.
  - Real spending balance comparison badges and clickable history badges to directly apply suggested amounts.
  - ⚡ Sync button for committed expenses to instantly align budget amounts.
  - Exact cent matching for fixed charges and corrected average calculation for monthly/yearly categories.
- **Action History & Auditability 📜**:
  - Added deep dive details modal for undoable actions with dynamic entity name resolution (accounts, budgets, recurrences).
  - Smart dependency verification and inline confirmation before action reversal.
  - Automatic exclusion of AI facts/memories from global audit history.

### Fixed & Improved
- **AI Assistant & Chat Optimizations 💬**:
  - Optimized local LLM proactive memory and refined backend tool usage.
  - Cleaned up and reorganized unwanted categories suggested by AI.
  - Automatically hidden suggestion panel when no recommendation is needed.
  - Fixed scroll issues during bulk budget envelope deletions.
- **Maintenance & i18n 🌐**:
  - Automated alphabetical sorting and key alignment across i18n files (FR / EN).
  - Removed frugal/austerity wording in favor of a neutral and supportive tone.

## [1.0.69] - 2026-07-19

### Added
- **Accent-Insensitive Search 🔍**: Implemented accent-insensitive and case-insensitive search capability across Dashboard (Timeline), Operations History, Recurrence templates, and Budget envelope categories.

### Fixed
- **Budget Envelope Category Selection bug 💰**: Resolved an issue where filtering categories during budget editing would cause hidden checked categories to be lost on save. Selection is now managed in JS state instead of relying purely on visible DOM elements.

## [1.0.68] - 2026-07-18

### Added
- **Global Activity & Undo System 🕓**: Full write operation tracking (CRUD) across all entities. Header undo/redo arrows, paginated "Actions" panel, and toast notifications for instant reversal.
- **Multi-Account Block Parsing 🏦**: Automatic segment extraction from concatenated multi-account bank exports (e.g. Crédit Agricole single-sheet exports with Livret A, LDD, etc.).
- **Match Confidence Index**: Confidence score (0-100%) with auto-parse above 50% and manual segment selection dropdown below 50%.
- **Import Modal Row Filters 🔍**: "All / To Add / To Reconcile" filter tabs in the import verification modal.
- **Import Validation Alerts 📥**: Duplicate, old file, gap (>3d), obsolescence (>7d), and account-change detection warnings on statement import.
- **AI Budget Summary Tool**: Consolidated `get_budgets_status` tool returning budgeted/spent/reconciled/remaining for AI reasoning.
- **AI Chat Auto-Scroll Lock**: Direction-aware lock with 30px bottom threshold to prevent accidental re-engagement.
- **AI Write Capabilities & Validation Queue (Human-in-the-Loop) 🔐**: 10 CRUD tools for Ollama — all writes are simulated, reviewed via side-by-side comparison modal, and only committed on explicit user validation.
- **i18n Improvements**: Migrated all AI action boxes, modals, and buttons to translation layer; refined French translations.
- **Improved AI Chat Context Compression**: New buffered compression with user feedback indicator ("Compression en cours..."), 90% threshold, and synced LLM summary call. Compressed summary appears as a collapsible bubble in the conversation timeline with inline editing, delete (reverts to raw sliding window), and regenerate (with custom instruction via dedicated modal). Fully non-destructive — all messages preserved in DB. Crash recovery resets stuck compression after 5 min.
- **Chat IA Cancellation Persistence**: Interrupted responses (either via new message stream, context regeneration, or message edits) now correctly display the cancel banner and persist in the database, surviving page refreshes (F5).
- **Stop Button on Message Edits**: The "Stop" button is now visible and fully functional when saving an edited user message.
- **Global Undo/Redo Header Synchronization**: Global Undo/Redo arrows in the header now update immediately upon any backend write operation (such as AI tool executions) or tab switches.
- **Friendly Tool Badges in Chat**: Replaced raw technical tool names on badges with localized friendly descriptions.
- **Tool Call Execution English Localization**: Localized status messages while the backend is executing tools when using the English interface.

### Fixed
- **Undo/Redo Tooltips i18n**: Action labels in undo/redo tooltips are now fully translated based on user language (was hardcoded in French from backend). Includes prepositional forms per language (FR: "de l'", "du", "de la" / EN: "of").

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
