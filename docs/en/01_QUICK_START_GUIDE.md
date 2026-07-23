# 🚀 Quick Start Guide - OmniBank Local

This guide takes you step by step from launching OmniBank Local for the first time to exporting a safety backup of your database, importing bank statements, and tracking your budgets.

---

## 📸 Overview of the User Journey

![Welcome Wizard](../../screenshots/01_wizard_acceuil.png)

---

## 1. First Launch & Initial Setup Wizard

On the very first launch of the application, the welcome wizard opens automatically:

1. **Language Selection**: Choose French (FR) or English (EN).
2. **First Bank Account Creation**:
   - Enter your account name (e.g., *Main Checking Account*).
   - Select the account type (*Checking*, *Savings*, *Credit Card*, etc.).
   - Set the initial balance of your account on the starting date.
3. **Default Categories**: OmniBank automatically seeds a complete tree of predefined financial categories (Groceries, Housing, Transport, Entertainment, Salary, etc.).
4. **Optional AI Configuration (Ollama)**:
   - If Ollama is installed on your computer (`http://localhost:11434`), OmniBank detects it automatically and lists available models (e.g., `gemma4:e4b` recommended, `mistral`, `llama3`, `qwen`).

---

## 2. Data Ingestion: Importing a CSV / XLSX Statement

To populate your accounts without tedious manual entry:

1. Go to the **Dashboard** or **History** page, then click the **"📥 Import Statement"** button.
2. **File Selection**: Drag and drop the `.csv`, `.xlsx`, or `.txt` file downloaded from your bank's web portal.
3. **Column Mapping**:
   - The import wizard automatically detects the delimiter (comma, semicolon, or tab) and encoding (UTF-8, ISO-8859-1).
   - If needed, associate your file's columns with OmniBank fields (*Date*, *Description*, *Amount*, *Payee*).
4. **Preview, Categorization & Reconciliation Difference**:
   - OmniBank compares imported rows with existing transactions to highlight duplicates.
   - Trigger the local AI (**`gemma4:e4b`**) via **"🤖 Analyze with AI"** to assign fitting categories (prioritizing existing categories).
   - Enter your official bank statement ending balance: the **Reconciliation Difference drops to 0.00 €** in green when selected rows match perfectly.

---

## 3. Daily Management & Bank Reconciliation

![Dashboard after Reconciliation](../../screenshots/02_dashboard_après_rapprochement.png)

1. **Quick Operation Entry**: Click the **"+ New Operation"** button to record an expense, income, or transfer.
2. **Bank Reconciliation**:
   - When reviewing your bank statement, toggle the reconciliation status in the **Reconciliation** column to mark transactions as reconciled.
   - Your account balance splits into **Reconciled (Real) Balance** and **Pending (Expected) Balance**.

---

## 4. Budget Envelopes & AI Advice

![Budgets & AI](../../screenshots/05_budgets.png)

1. **Setting a Budget**: Go to the **Budgets** section and assign a monthly envelope cap for a category (e.g., *Groceries: $400*).
2. **Visual Progress**: A color-coded progress bar indicates spending in real time (Green = Under control, Orange = Warning, Red = Overbudget).
3. **AI Suggestions**: Click **"AI Suggestions"** to have the local Ollama model analyze your spending history and propose realistic budget adjustments.

---

## 5. Backup, Restore & SQLite Database Export

Your financial records are 100% local and stored in the SQLite database file `omnibank.db`.

### Manual Backup Export:
1. Go to **Settings / Configuration** (gear icon ⚙️).
2. Navigate to the **Data Management** section.
3. Click **"Download Full Backup (ZIP)"** or **"Export Data (CSV)"**.
4. Save the `.zip` archive containing the SQLite database and configuration to a safe folder of your choice (USB drive, external disk, local vault).

### Restoration:
When switching computers, reinstall OmniBank Local, go to **Settings > Data Management**, select **"Restore Backup (ZIP)"**, choose your archive file, and confirm. All your accounts, categories, transactions, and settings will be restored instantly.
