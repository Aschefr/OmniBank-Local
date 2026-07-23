# Official OmniBank Local Documentation 🏦

Welcome to the official English documentation for **OmniBank Local**, the local-first personal and association finance management application.

OmniBank Local is designed around the core principle of **Total Data Sovereignty (Zero Cloud)**: your financial records never leave your machine, the SQLite database runs locally on device, and all AI assistance features rely on a local **Ollama** instance.

---

## 📚 Documentation Index

The documentation consists of general guides explaining core concepts and dedicated page-by-page files for context-aware usage.

### 🚀 General Guides

1. 📖 **[Quick Start Guide](01_QUICK_START_GUIDE.md)**
   - From initial installation and setup wizard to account creation, statement import, and DB backup export.

2. ⚙️ **[Pipelines & Deep-Dive Technical Analysis](02_FIRST_LAUNCH_AND_PIPELINES.md)**
   - Technical analysis: Setup wizard, CSV/XLSX parsing & deduplication, financial engine & reconciliation, automated backups and DB exports.

3. 🛠️ **[Technical Architecture & Tools](03_TECHNICAL_ARCHITECTURE_AND_TOOLS.md)**
   - Software stack (FastAPI, SQLite, Tauri 2.x, Vanilla JS), SQL database schema, local Ollama AI integration (RAG & Function Calling), and i18n management.

---

### 📄 Detailed Page-by-Page Guides (`pages/`)

Directly access the reference guide corresponding to the screen you are currently using:

| Page / Feature | Reference Document | Description |
| :--- | :--- | :--- |
| **Dashboard** | 📊 [01_DASHBOARD.md](pages/01_DASHBOARD.md) | Visual summary of accounts, balance charts, and quick operation entry. |
| **History & Operations** | 📜 [02_HISTORY_AND_OPERATIONS.md](pages/02_HISTORY_AND_OPERATIONS.md) | Complete transaction log, multi-criteria filters, and bank reconciliation. |
| **Analytics Synthesis** | 📈 [03_ANALYTICS_SYNTHESIS.md](pages/03_ANALYTICS_SYNTHESIS.md) | Consolidated Category x Month income/expense matrix and PDF report export. |
| **Budgets & AI** | 🎯 [04_BUDGETS_AND_AI_SUGGESTIONS.md](pages/04_BUDGETS_AND_AI_SUGGESTIONS.md) | Budget envelope management, cap tracking, and Ollama AI advice generator. |
| **Trends** | 📉 [05_TRENDS.md](pages/05_TRENDS.md) | Graphical visualization of financial evolution over time. |
| **AI Assistant Chat** | 🤖 [06_OLLAMA_AI_CHAT.md](pages/06_OLLAMA_AI_CHAT.md) | 100% offline conversational chat with Function Calling for autonomous actions. |
| **Recurrences** | 🔁 [07_RECURRENCES_AND_SCHEDULE.md](pages/07_RECURRENCES_AND_SCHEDULE.md) | Subscription management, recurring bills, auto-projection & Table/Gantt modes. |
| **Categories** | 🏷️ [08_CATEGORIES.md](pages/08_CATEGORIES.md) | Custom category & subcategory hierarchy with icon and color customization. |
| **Accounts** | 💳 [09_ACCOUNTS.md](pages/09_ACCOUNTS.md) | Bank account management (Checking, Savings, Cards), initial balances, and internal transfers. |
| **Configuration & License** | ⚙️ [10_CONFIGURATION_AND_LICENSE.md](pages/10_CONFIGURATION_AND_LICENSE.md) | Global settings, Ollama connection, i18n, maintenance tools, and Organization Mode license. |
| **Wizards & Statement Import** | 📥 [11_WIZARDS_AND_CSV_IMPORT.md](pages/11_WIZARDS_AND_CSV_IMPORT.md) | Initial setup wizard and CSV/XLSX statement import & reconciliation wizard. |

---

## 🎨 Screenshots and Illustrations

All documentation guides use screenshots from the project's `screenshots/` directory to illustrate interface features.

---

## 🔒 Privacy & Offline Guarantee

- **Zero Telemetry**: No data packets are ever sent to remote third-party servers.
- **Local Storage**: All your transactions are stored in the local SQLite database file `omnibank.db`.
- **Private Ethical AI**: AI features interact exclusively with the local Ollama API running on your own computer (e.g., `localhost:11434`).
