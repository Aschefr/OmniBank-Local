# 🌐 Comprehensive REST API & Swagger (OpenAPI) Documentation

Welcome to the official REST API reference for **OmniBank Local**.

This documentation describes all endpoints, data structures, headers, and behaviors of the Python FastAPI backend engine powering OmniBank Local.

---

## 🧭 Table of Contents

1. [Core Principles & Data Sovereignty](#1-core-principles--data-sovereignty)
2. [Accessing Swagger UI & ReDoc](#2-accessing-swagger-ui--redoc)
3. [Multi-Profile Architecture & HTTP Headers](#3-multi-profile-architecture--http-headers)
4. [Reference of 26 API Modules](#4-reference-of-26-api-modules)
   - [Transactions & Operations](#41-transactions--operations-transactions)
   - [Bank Accounts](#42-bank-accounts-accounts)
   - [Categories & Tree Hierarchy](#43-categories--tree-hierarchy-categories)
   - [Budgets & Envelopes](#44-budgets--envelopes-budgets)
   - [Auto-Pilot Control Center](#45-auto-pilot-control-center-autopilot)
   - [Recurrences & Scheduled Ops](#46-recurrences--scheduled-ops-recurrences)
   - [Direct Bank Sync (Woob)](#47-direct-bank-sync-bank-sync)
   - [Smart Labels Normalization](#48-smart-labels-normalization-smart-labels)
   - [AI Assistant & Local RAG (Ollama)](#49-ai-assistant--local-rag-chat--ai)
   - [Statistics & Living Allowance](#410-statistics--living-allowance-stats)
   - [Wealth & Cash Flow Simulator](#411-wealth--cash-flow-simulator-simulator)
   - [Audit Trail & Undo/Redo Engine](#412-audit-trail--undoredo-engine-history)
   - [Profiles & Data Isolation](#413-profiles--data-isolation-profiles--cross-profile)
   - [CSV Pipeline Import & Export](#414-csv-pipeline-import--export-csv)
   - [Backups & Automated Snapshots](#415-backups--automated-snapshots-backup--auto_backup)
   - [Database Maintenance & Vacuum](#416-database-maintenance--vacuum-maintenance)
   - [Notification Center & Alerts](#417-notification-center--alerts-notifications)
   - [Configuration & Preferences](#418-configuration--preferences-config)
   - [Licensing & Organisation Mode](#419-licensing--organisation-mode-license--orgusers)
   - [Diagnostics & System Health](#420-diagnostics--system-health-diagnostics--system)
5. [Practical Integration Examples](#5-practical-integration-examples)
6. [Regenerating OpenAPI Specifications](#6-regenerating-openapi-specifications)

---

## 1. Core Principles & Data Sovereignty

OmniBank Local is strictly architected on **Local-First** and **Zero-Cloud** principles:
- **Local Storage**: All reads and writes target local SQLite databases on your physical drive (`data/omnibank.db` or dedicated profile DB).
- **Zero Telemetry**: No telemetry, analytics token, or external packet is transmitted.
- **Offline AI**: All enrichment and AI chat calls communicate solely with your local **Ollama** daemon (`http://localhost:11434`).
- **OpenAPI 3.1 Standard**: Complete API schemas are strictly documented in OpenAPI v3.1.0 format.

---

## 2. Accessing Swagger UI & ReDoc

When OmniBank Local is running (default port `8434`), interactive exploration tools are immediately available:

| Interface | Local URL | Description |
| :--- | :--- | :--- |
| **Swagger UI** | [http://localhost:8434/docs](http://localhost:8434/docs) | Interactive sandbox: test live endpoints ("Try it out"), inspect schemas and response status codes. |
| **ReDoc** | [http://localhost:8434/redoc](http://localhost:8434/redoc) | Clean, responsive technical reading view optimized for offline consultation. |
| **OpenAPI Schema (JSON)** | [http://localhost:8434/openapi.json](http://localhost:8434/openapi.json) | Live raw OpenAPI 3.1.0 JSON specification served directly by FastAPI. |
| **Static Schema Files** | `docs/api/openapi.json`<br>`docs/api/openapi.yaml` | Ready-to-import files for Postman, Insomnia, or client code generators. |

### 🔒 100% Offline Guarantee (Zero CDN)
All Swagger UI and ReDoc bundle assets are physically vendored into `static/vendor/swagger-ui/`. No outbound queries to `cdn.jsdelivr.net` or third-party CDNs are performed.

---

## 3. Multi-Profile Architecture & HTTP Headers

OmniBank Local isolates user workspaces (e.g. *Personal*, *Freelance*, *Association*).

### `X-Profile-ID` Header
Target a specific profile database by passing its identifier:
```http
GET /api/transactions/ HTTP/1.1
Host: 127.0.0.1:8434
X-Profile-ID: association_loi_1901
```
*If omitted, the backend defaults to the currently active profile.*

---

## 4. Reference of 26 API Modules

### 4.1. Transactions & Operations (`transactions`)
Manages transactions: manual input, editing, categorization, reconciliation, and deletion.
- `GET /api/transactions/` : Filtered list of transactions (search, account, date range, reconciled status).
- `POST /api/transactions/` : Create a new transaction.
- `PUT /api/transactions/{id}` : Update transaction details with real-time balance recalculation.
- `DELETE /api/transactions/{id}` : Delete transaction and restore balances.
- `POST /api/transactions/{id}/reconcile` : Toggle bank reconciliation with timestamp.
- `GET /api/transactions/descriptions` : Autocomplete common merchants.
- `GET /api/transactions/autopilot/history` : Retrieve recent transactions autonomously modified by Auto-Pilot.

### 4.2. Bank Accounts (`accounts`)
Management of checking, savings, investment, and cash accounts.
- `GET /api/accounts/` : List all accounts with real-time computed balances.
- `POST /api/accounts/` : Create a new account with initial balance.
- `PUT /api/accounts/{id}` : Update account settings (name, color, type).
- `DELETE /api/accounts/{id}` : Close or archive an account.
- `PUT /api/accounts/{id}/balance` : Adjust initial balance.

### 4.3. Categories & Tree Hierarchy (`categories`)
Hierarchical category structure for income, fixed expenses, variable expenses, and internal transfers.
- `GET /api/categories/` : Full category tree with icons and colors.
- `POST /api/categories/` : Create new parent or subcategory.
- `PUT /api/categories/{id}` : Edit category properties.
- `DELETE /api/categories/{id}` : Delete category.
- `GET /api/categories/averages` : Monthly historical expenditure averages per category.

### 4.4. Budgets & Envelopes (`budgets`)
Envelopes management: monthly, annual, and project-based limits.
- `GET /api/budgets/` : List active envelopes with consumed amounts and alerts.
- `POST /api/budgets/` : Create a new budget envelope.
- `PUT /api/budgets/{id}` : Adjust budget cap or rules.
- `DELETE /api/budgets/{id}` : Archive or remove budget envelope.
- `POST /api/budgets/copy-previous` : Copy envelope limits from preceding month.

### 4.5. Auto-Pilot Control Center (`autopilot`)
Autonomous finance engine: envelope discovery, EMA recalibration, auto-skip, and decision audit logs.
- `GET /api/autopilot/status` : Full engine telemetry, confidence score, and review queue.
- `POST /api/autopilot/toggle` : Enable or disable Auto-Pilot master switch.
- `POST /api/autopilot/preset` : Apply preset ('balanced', 'full_auto', 'conservative').
- `GET /api/autopilot/decisions` : Audit log of autonomous decisions.
- `POST /api/autopilot/decisions/{id}/revert` : Surgical rollback of an action.

### 4.6. Recurrences & Scheduled Ops (`recurrences`)
Periodic operations (subscriptions, rent, salaries).
- `GET /api/recurrences/` : List recurrence templates.
- `POST /api/recurrences/` : Create recurrence rule.
- `PUT /api/recurrences/{id}` : Modify recurrence amount or period.
- `POST /api/recurrences/generate` : Materialize due events into real transactions.

### 4.7. Direct Bank Sync (`bank-sync`)
Local Woob connector with AES-256 Fernet credentials vault and integrity staging area.
- `GET /api/bank-sync/backends` : Supported bank connectors.
- `GET /api/bank-sync/connections` : Configured bank connections.
- `POST /api/bank-sync/connections` : Add and locally encrypt bank connection.
- `POST /api/bank-sync/sync-now` : Trigger offline bank sync.
- `GET /api/bank-sync/pending` : Inspect pending imported transactions in staging buffer.
- `POST /api/bank-sync/pending/validate` : Approve and commit pending transactions.

### 4.8. Smart Labels Normalization (`smart-labels`)
Merchant learning and automatic normalization rules.
- `POST /api/smart-labels/resolve-batch` : Resolve raw descriptions into clean merchant names & categories.
- `POST /api/smart-labels/simulate` : Test pattern resolution without saving.
- `GET /api/smart-labels/mappings` : List learned merchant mappings.
- `POST /api/smart-labels/mappings` : Create or update mapping rule.

### 4.9. AI Assistant & Local RAG (`chat` & `ai`)
Offline AI chatbot powered by Ollama with RAG context and safe function calling.
- `GET /api/chat/sessions` : List active chat threads.
- `POST /api/chat/sessions` : Create new conversation thread.
- `POST /api/chat/sessions/{id}/message` : Send message and stream SSE reply.
- `POST /api/ai/categorize` : Heuristic-based single transaction categorization.
- `POST /api/ai/categorize_batch` : Batch auto-categorization.

### 4.10. Statistics & Living Allowance (`stats`)
Analytical aggregates, cash flow trends, and living allowance ("reste à vivre").
- `GET /api/stats/dashboard` : Consolidated dashboard metrics.
- `GET /api/stats/accounts` : Temporal account balance curves for Chart.js.
- `GET /api/stats/categories-breakdown` : Category breakdown charts.
- `GET /api/stats/monthly-summary` : Inflow vs. outflow comparison.

### 4.11. Wealth & Cash Flow Simulator (`simulator`)
Multi-scenario 1-to-30-year projections including inflation and financial events.
- `GET /api/simulator/presets` : Ready-to-use scenario templates.
- `GET /api/simulator/scenarios` : List saved scenarios.
- `POST /api/simulator/scenarios` : Create projection scenario.
- `POST /api/simulator/scenarios/{id}/run` : Execute simulation and generate cash trajectory.

### 4.12. Audit Trail & Undo/Redo Engine (`history`)
Full trace of changes with diff snapshots and instant rollback (`Ctrl+Z`).
- `GET /api/history` : Paginated audit trail.
- `GET /api/history/{id}/check` : Pre-flight rollback safety validation.
- `POST /api/history/{id}/undo` : Undo recorded mutation.
- `POST /api/history/{id}/redo` : Redo previously undone mutation.

### 4.13. Profiles & Data Isolation (`profiles` & `cross-profile`)
Workspace separation and mirror inter-profile transfers.
- `GET /api/profiles/` : List all profiles.
- `POST /api/profiles/` : Create isolated profile.
- `POST /api/profiles/switch` : Switch active profile instantly.
- `POST /api/cross-profile/transfer` : Execute cross-profile transfer.

### 4.14. CSV Pipeline Import & Export (`csv`)
Dialect detection, duplicate filtering, and bank statement import.
- `POST /api/csv/import` : Parse and import CSV statement.
- `GET /api/csv/export` : Export transactions ledger to CSV.

### 4.15. Backups & Automated Snapshots (`backup` & `auto_backup`)
Live hot backups, restore endpoints, and auto-backup scheduler.
- `GET /api/backup/download` : Download active profile ZIP archive.
- `POST /api/backup/upload` : Restore active profile from archive.
- `GET /api/backup/download-all` : Global system backup.
- `GET /api/backup/auto/status` : Scheduler state and snapshot list.

### 4.16. Database Maintenance & Vacuum (`maintenance`)
SQLite maintenance operations.
- `POST /api/maintenance/vacuum` : Execute SQLite `VACUUM`.
- `GET /api/maintenance/integrity-check` : Run `PRAGMA integrity_check`.
- `POST /api/maintenance/recalculate-balances` : Recalculate all account balances.

### 4.17. Notification Center & Alerts (`notifications`)
Financial alerts and status reports.
- `GET /api/notifications` : List active notifications.
- `PUT /api/notifications/{id}/read` : Mark alert as read.
- `PUT /api/notifications/read-all` : Mark all alerts as read.

### 4.18. Configuration & Preferences (`config`)
App-wide configuration, currencies, and Ollama connection.
- `GET /api/config/` : Retrieve all config parameters.
- `POST /api/config/` : Update settings (language, thresholds, currency).
- `GET /api/config/ollama/models` : List locally detected Ollama models.

### 4.19. Licensing & Organisation Mode (`license` & `OrgUsers`)
License management and multi-user roles for non-profits and team accounts.
- `GET /api/license/status` : Verify license tier.
- `POST /api/license/activate` : Validate and activate license key.
- `GET /api/org_users/` : List organization members.

### 4.20. Diagnostics & System Health (`diagnostics` & `system`)
Technical health, changelog, and file attachments.
- `GET /api/health` : Server health check (`{"status": "ok"}`).
- `GET /api/version` : Current app version.
- `GET /api/changelog` : Release notes from `CHANGELOG.md`.
- `POST /api/upload` : Secure file upload (max 50 MB).

---

## 5. Practical Integration Examples

### Example: Creating a transaction via cURL
```bash
curl -X POST "http://127.0.0.1:8434/api/transactions/" \
     -H "Content-Type: application/json" \
     -H "X-Profile-ID: default" \
     -d '{
       "date_operation": "2026-10-03",
       "date_saisie": "2026-10-03",
       "description": "Office Supplies",
       "amount": -45.50,
       "type": "expense_var",
       "category": "Office",
       "from_account_id": 1
     }'
```

---

## 6. Regenerating OpenAPI Specifications

Run the generator whenever routes are added or modified:
```bash
python scripts/export_openapi.py
```
This updates:
- `docs/api/openapi.json`
- `docs/api/openapi.yaml`
