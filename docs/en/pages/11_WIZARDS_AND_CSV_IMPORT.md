# 📥 Page Documentation: Initial Setup & Statement Import Wizards

This document details the complete operation of OmniBank Local's two interactive wizards: the **Initial Setup Wizard** presented on first launch and the **Statement Import & Reconciliation Wizard** for ingesting bank statements.

---

## 📸 Illustration

![Welcome Wizard](../../../screenshots/01_wizard_acceuil.png)
*Guided initial setup wizard screen.*

---

## 🧙‍♂️ 1. Initial Setup Wizard

On OmniBank Local's first launch (or when clicking *"Re-launch Setup Wizard"* in Configuration), the **Setup Wizard** guides user onboarding through 6 or 7 steps (`static/js/views/setup_wizard.js`):

1. **👋 Step 0: Welcome & Language**
   - UI language selection (French FR or English EN).
   - Optional Organization Mode activation (CSE / Association).
2. **🏦 Step 1: Bank Account Creation**
   - Set up initial accounts: Account Name, Type (*Checking*, *Savings*, *Credit Card*...), starting balance, and badge color.
   - Select main account.
3. **👥 Step 2 (Organization Mode): Organization Users**
   - *(Only if Organization Mode is active)*: Create user profiles (e.g., *President*, *Treasurer*) for multi-user audit tracking.
4. **💰 Step 3: Salary / Main Income Setup**
   - Usual salary payment day (e.g., 28th of the month), average net amount, and bi-monthly option.
5. **📝 Step 4: Initial Categories**
   - Validate and seed default category tree (Groceries, Housing, Transport, Leisure, Health, Salary, etc.).
6. **🤖 Step 5: Ollama AI Assistant**
   - Detect local Ollama instance (`http://127.0.0.1:11434`), test connection, and select initial model (**`gemma4:e4b`** recommended).
7. **🚀 Step 6: Completion**
   - Summary of settings and launch button leading to the Dashboard.

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
