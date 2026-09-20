# 🛠️ Technical Architecture & Tools

This document outlines the software architecture, SQLite database schema, i18n translation system, and local Ollama AI integration in OmniBank Local.

---

## 🏗️ Global Architecture

OmniBank Local uses a high-performance, autonomous **local-first Desktop / Web** architecture:

```
+-----------------------------------------------------------------------+
|                         CLIENT APPLICATION                            |
|  Tauri 2.x (Rust Container) OR Web Browser (Chrome/Firefox/Edge)      |
|                                                                       |
|  Vanilla HTML5 / CSS3 / ES6 JS Frontend Modules                       |
|  - VirtualTable (High-performance rendering for large datasets)       |
|  - Chart.js (Interactive data visualization)                          |
+-----------------------------------------------------------------------+
                                  |
                           HTTP / SSE / REST
                                  v
+-----------------------------------------------------------------------+
|                      LOCAL BACKEND SERVER                             |
|  Python FastAPI + Uvicorn Async Server                                |
|                                                                       |
|  Routers & Services:                                                  |
|  - Finance Engine (Balance & budget calculations)                     |
|  - Auto-Pilot Engine (Envelope discovery, EMA recalibration)          |
|  - CSV Parser & Bank Sync Manager (Woob / local synchronization)      |
|  - Backup & Auto-Backup Manager                                       |
|  - Budget AI & Chat Service (Local RAG & Function Calling)            |
+-----------------------------------------------------------------------+
           |                                             |
   SQLAlchemy ORM                                Local HTTP (Port 11434)
           v                                             v
+-----------------------+                     +-----------------------+
|  SQLite Database      |                     |  OLLAMA Instance      |
|  (omnibank.db)        |                     |  (Offline Local LLM)  |
+-----------------------+                     +-----------------------+
```

---

## 💾 SQLite Database Schema

The SQLite database `omnibank.db` relies on a normalized relational schema via SQLAlchemy ORM models:

### Main Tables:
1. `accounts`: Bank accounts (`id`, `name`, `type` ['Checking', 'Savings'...], `initial_balance`, `is_closed`, `color`).
2. `categories`: Categories & subcategories (`id`, `parent_id`, `name`, `type` ['expense_fixed', 'expense_var', 'income', 'transfer'], `icon`, `color`).
3. `transactions`: Financial transactions (`id`, `csv_id`, `date_saisie`, `date_operation`, `description`, `amount`, `type`, `category`, `reconciliation_date`, `from_account_id`, `to_account_id`, `recurrence_id`, `budget_id`, `created_by`, `modified_by`).
4. `budgets` & `budget_categories`: Multi-category budget envelopes (`id`, `name`, `monthly_amount`, `period`, `is_locked`, `is_closed`, `is_project`, `envelope_type`, `base_annual_amount`).
5. `recurrence_templates`: Recurrence templates (`id`, `description`, `amount`, `type`, `category`, `frequency` ['Monthly', 'Yearly', 'Bi-Monthly'...], `day_of_month`, `is_closed`, `max_occurrences`).
6. `autopilot_decision_logs`: Timestamped decision register for autonomous actions and suggestions (envelope creation, enrichment, recalibration, auto-skipping, auto-closing) with raw JSON snapshots and statuses (`SUGGESTED`, `AUTO_COMMIT`, `DISMISSED`).
7. `history` (`ActionHistory`): Audit log of user actions, undo stack, and entity modifications.
8. `config` / `global_config`: Key-value application settings (language, theme, Ollama URL, Auto-Pilot options, minimum floor thresholds).
9. `org_users`: Organization Mode user profiles and audit tracking (for associations / CSE).

---

## 🤖 Local AI Integration (Ollama RAG & Function Calling)

OmniBank Local features a **100% offline** AI assistant powered by **Ollama** (`app/routers/chat.py` and `app/services/budget_ai_service.py`).

### 1. Local RAG (Retrieval-Augmented Generation) Architecture
When asking financial questions in the AI Chat (e.g., *"How much did I spend on restaurants last month?"*):
1. The backend extracts anonymized spending aggregates relevant to the queried period from SQLite.
2. A secure financial context prompt is prepared and sent to Ollama's local API endpoint.
3. The LLM (**`gemma4:e4b`** recommended, Mistral, Llama 3, Qwen) generates an analytical response without any personal data leaving the machine.

### 2. Native Function Calling (Autonomous Tool Execution)
The AI assistant can execute financial management actions upon user request via structured JSON tool declarations (*Function Calling*):
- `create_transaction`: Prepares a transaction creation draft for user confirmation.
- `set_budget`: Proposes an envelope budget adjustment.
- `analyze_trends`: Computes period-over-period variations.

---

## 🌐 System I18n (Internationalization FR / EN)

- Translation files are stored in `data/i18n/fr.json` and `data/i18n/en.json`.
- **Strict Encoding Requirement**: i18n JSON files must be saved in **UTF-8 with BOM (utf-8-sig)** to guarantee cross-platform Python/Windows compatibility.
- The JS module `static/js/i18n.js` loads the active language and dynamically translates UI string keys (`i18n.t('key')`) without requiring page reloads.
