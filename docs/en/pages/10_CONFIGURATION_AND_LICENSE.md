# ⚙️ Page Documentation: Configuration & License

The **Configuration** page gathers global application settings, Ollama AI integration, interface preferences, Organization Mode user management, data export/import tools, and automated backup options.

---

## 📸 Illustration

![Configuration Page](../../../screenshots/11_configuration.png)
*Global configuration panel in OmniBank Local.*

---

## 🛠️ Components, Buttons & Activable Features

### 🤖 1. Ollama AI Configuration

- **"Enable AI" Toggle**: Globally enables or disables local AI features (Chat & Budget suggestions).
- **"Ollama URL" Field**: Endpoint address for your local Ollama instance (default `http://127.0.0.1:11434`).
- **"🔄 Test & Fetch Models" Button**: Queries local Ollama API, tests connection, and refreshes detected LLM model lists.
- **"Selected Model" Dropdown**: Selects active LLM model. **`gemma4:e4b`** is strongly recommended and tested during development.
- **"Temperature (Creativity)" Slider** (0.0 to 1.0): Adjusts model randomness (0.1 to 0.3 recommended for financial accuracy).
- **Context Size Input & Quick Buttons (2K, 4K, 8K, 16K, 32K)**: Sets memory context window size (e.g., default 4096 tokens).
- **"Enable AI Financial Health Reports" Toggle**: Activates proactive background financial analysis.
  - **"Reports Frequency" Dropdown**: Daily, Weekly (recommended), or Monthly.
  - **"⚡ Generate Report Now" Button**: Triggers an immediate summary health report notification.

---

### ⚙️ 2. Optional Features & Interface Settings

- **"Enable Bi-Monthly Recurrences" Toggle**: Enables support for twice-monthly salary and recurring schedules.
- **"Enable File Attachments" Toggle**: Enables uploading receipt/invoice files (PDF, images) attached to transactions.
- **"Enable Check Slip Numbers" Toggle**: Adds a check slip number input field for check transactions.
- **"Enable Organization Mode (CSE/Associations)" Toggle**: Unlocks multi-user role tracking and audit logs for collective entities (requires a license key).

---

### ⚙️ 3. General Settings

- **"Recurrence Months to Generate in Advance" Input** (1 to 36 months): Sets the **rolling auto-projection window** for recurring transactions (default 12 months).

---

### 👥 4. Organization Mode & License Key

- **Obtaining a License**: Organization Mode perpetual licenses are acquired by contacting Publisher **Amify Studio** (`contact@amify-studio.fr` — [amify-studio.fr](https://amify-studio.fr)). Full legal and pricing terms are detailed in the official [Organization License](../../LICENSE_ORGANISATION.md).
- **"License Key" Field**: Enter your license key delivered by Amify Studio to activate the module.
- **"Organization Users" Panel (`org_users`)**:
  - **"User Name" Input + "+ Add User" Button**: Creates organization user profiles (e.g., *President*, *Treasurer*) to trace action audit logs on shared workstations.

---

### 🖥️ 5. Shared Mode (Multi-Session Windows)

- Configures SQLite database file (`omnibank.db`) storage on a local shared directory to enable access across multiple Windows user accounts on the same PC.

---

### 📁 6. Data Management & Maintenance Tools

- **"📥 Export Data (CSV)" Button**: Exports all recorded transactions to a standard CSV file.
- **"📤 Import CSV to DB" Button**: Directly imports raw CSV files into the SQLite database.
- **"💾 Download Full Backup (ZIP)" Button**: Generates a secure ZIP archive containing `omnibank.db` and configuration settings.
- **"📂 Restore Backup (ZIP)" Button**: Restores accounts and data from a uploaded backup ZIP file.
- **"🧙 Re-launch Setup Wizard" Button**: Opens the welcome wizard without clearing existing data.
- **"🔧 Fix Inconsistent Types" Button**: Maintenance tool fixing mismatched category and transaction types.
- **"🧹 Clean Up Orphan Recurrences" Button**: Removes leftover expected transactions whose parent template was deleted.
- **"🔄 Convert 0€ Transactions to Skipped" Button**: Converts zero-amount expected transactions to skipped status automatically.
- **"⚠️ Clear Database" Button (Red)**: Critical action resetting the entire SQLite database after confirmation.

---

### 💾 7. Automatic Backups (Auto-Backup)

- **"Enable Automated Backups" Toggle**: Activates background periodic backup creation.
- **"Backup Frequency" Dropdown**: Daily, Weekly, or Monthly.
- **"Maximum Kept Backups" Dropdown** (3, 5, 10, or 20): Defines rolling backup retention policies.
- **"▶️ Trigger Auto-Backup Now" Button**: Immediately creates a backup snapshot in `data/backups/`.
