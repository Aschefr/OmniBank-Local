# 📥 Page Documentation: Initial Setup & Statement Import Wizards

This document details the complete operation of OmniBank Local's two interactive wizards: the **Initial Setup Wizard** presented on first launch and the **Statement Import & Reconciliation Wizard** for ingesting bank statements.

---

## 📸 Illustration

![Welcome Wizard](../../../screenshots/01_wizard_acceuil.png)
*Guided initial setup wizard screen.*

---

## 🧙‍♂️ 1. Initial Setup Wizard

On OmniBank Local's first launch (or when clicking *"Re-launch Setup Wizard"* in Configuration), the **Setup Wizard** guides user onboarding through 7 streamlined steps (`static/js/views/setup_wizard.js`):

1. **👋 Step 0: Welcome, Language & Live Theme**
   - UI language selection (French FR or English EN) and Global base currency (`EUR`, `USD`, `GBP`...).
   - **Instant Theme Selector**: Classic Dark, Classic Light, Titanium Dark, or Alabaster Light applied live to the interface.
   - Optional Organization Mode activation (CSE / Association).
2. **🔒 Step 1: Master Profile & Security**
   - Workspace profile naming (e.g. *Personal Finances*, *Household*).
   - Optional PIN code lock protection (4 to 6 digits) with auto-lock delay on inactivity.
   - Local automatic backup toggle (weekly timestamped ZIP archive).
3. **🏦 Step 2: Entry Mode & Bank Accounts**
   - Choose onboarding entry path: *Manual Entry*, *Import Bank Statement (CSV/Excel)*, or *Connect Online Bank (Woob)*.
   - For manual setup: Account Name, Type (*Checking*, *Savings*, *PEA*, *Life Insurance*...), starting balance, currency, and main account ⭐ badge.
4. **👥 / 💰 Step 3: Organization Users (Org Mode) OR Salary & Cold-Start Income (Standard Mode)**
   - *Organization Mode*: Set up team member names (e.g., *President*, *Treasurer*) for audit trails.
   - *Standard Mode*: Pay day of the month (1-31), bi-monthly option, and **estimated monthly net income** to instantly initialize the Rest to Live ("Reste à Vivre") and cashflow projections without waiting for historical records.
5. **📝 Step 4: Operations Guide & Preferred Home Screen**
   - Educational visual primer on transaction directions (Expense, Income, Transfer, Neutral) and key reconciliation badges.
   - Choice of default home screen: **Modern Bento Overview** (hero metrics, financial rhythm, forecasts) or **Classic Operations Journal** (full table and filters).
6. **🤖 Step 5: Ollama AI Assistant**
   - Auto-detects local Ollama instance (`http://127.0.0.1:11434`), lists installed models, provides install commands if offline, and offers optional periodic proactive financial checkups.
7. **🚀 Step 6: Confirmation, Launch & Demo Data**
   - Recap of appearance, security, accounts, and income settings.
   - Primary launch button leading to your chosen home view.
   - Secondary button to instantly explore with a pre-loaded sample dataset.

---

## 📥 2. Statement Import & Reconciliation Wizard

Accessible from the Dashboard or History via the **"📥 Import Statement"** button, this wizard runs a complete statement parsing, auto-categorization, and balance reconciliation workflow (`static/js/views/import_wizard.js`):

### 📄 Step 1: File Selection & Structure Detection
- **Target Account Selector (`importAccountSelect`)**: Choose target bank account (or *"No Account"* for neutral import).
- **Supported Formats**: `.csv`, Excel (`.xlsx`), or text files (`.txt`).
- **Automatic Encoding & Delimiter Detection**: Backend engine auto-detects encoding (UTF-8, ISO-8859-1 / Windows-1252), delimiters (comma, semicolon, tab), dates (ISO or French `DD/MM/YYYY`), and decimal separators.
- **Section Selector (`importSectionSelect`)**: If a statement file contains multiple tables or headers, a dropdown isolates specific sections.

### 📐 Step 2: Column Mapping
If file structure is not recognized automatically by bank presets, column dropdowns map file fields to OmniBank fields:
- **Operation Date & Entry Date**
- **Description / Label**
- **Amount**: Single amount column (+/- signs) or separate Debit / Credit columns (in which case debit values are negated automatically).
- **Payee / Beneficiary** (Optional).

### 🔍 Step 3: Preview Grid, Categorization & Action Buttons

An interactive preview grid lists all parsed rows. Users can edit values directly per row: Date, Description, Operation Type (*Fixed Expense*, *Variable Expense*, *Income*, *Transfer*), Category, and selection checkbox.

#### Specific Options & Action Buttons:
- **Automated Deduplication**: Existing database transactions matching fingerprint (`date + amount + description`) are highlighted in orange and unchecked by default to prevent double-counting.
- **Historical Autocompletion**: Typing descriptions suggests autocompletion matches from past entries (`importDescList`) and auto-assigns associated categories.
- **"🤖 Analyze with AI" Button (`btnAnalyzeAI`)**: Sends unassigned descriptions to local Ollama model (**`gemma4:e4b`**) to assign fitting categories (prioritizing existing categories).
- **"🏷️ Categorize All with AI" Button (`btnCategorizeAllAI`)**: Resubmits all grid rows to AI to assign fitting categories (prioritizing existing categories).
- **Display Filters**: Toggle buttons to view All rows, Debits/Expenses only, Credits/Income only, or Hide duplicates.

### ⚖️ Step 4: Statement Balance Reconciliation (Equilibrium Verification)
- **"Statement Balance Verification" Box (`balanceVerificationBox`)**: Input field to enter the official ending statement balance from your paper/PDF bank statement.
- **Reconciliation Difference Calculation**: Calculates real-time theoretical ending balance. When selected rows match statement lines exactly, the **Reconciliation Difference reaches 0.00 €** in green, confirming 100% balance agreement with your bank.

### 💾 Step 5: Validation & SQL Insertion
- **"Save Import" Button (`btnSaveImport`)**: Confirms import. Selected transactions write atomically to SQLite `omnibank.db`, and account balances update instantly.
