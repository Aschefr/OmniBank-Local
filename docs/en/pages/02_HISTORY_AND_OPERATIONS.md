# 📜 Page Documentation: History & Operations

The **History & Operations** page is the primary tool for searching, filtering, editing, and **reconciling** all transactions recorded in OmniBank Local.

---

## 📸 Illustrations

![Operations History](../../../screenshots/03_historique.png)
*Complete view of the operations history table.*

![Before Reconciliation](../../../screenshots/02_dashboard_avant_rapprochement.png)
*Transaction state prior to bank reconciliation.*

![After Reconciliation](../../../screenshots/02_dashboard_après_rapprochement.png)
*Updated balances and row state following transaction reconciliation.*

---

## 🛠️ Components & Features

### 1. High-Performance `VirtualTable` Rendering
Powered by `VirtualTable` (`static/js/virtual_table.js`), the history view handles tens of thousands of transactions with high-speed virtual rendering (rendering only visible rows in the viewport).

### 2. Multi-Criteria Filter Bar
- **Global Search**: Instantly filter by keyword (merchant name, description, note).
- **Account Filter**: Display all accounts or isolate a specific account.
- **Period Filter**: Current month, previous month, full year, or custom date range.
- **Category Filter**: Filter by specific category or subcategory.
- **Status Filter**: Reconciled only, Unreconciled only, or All.

### 3. Operation Reconciliation
Reconciliation marks transactions against your official bank statement to track differences between real and expected balances:

1. Have your official bank statement ready.
2. In the **Reconciliation** column of the table (or via row edit / batch actions), toggle the operation status to mark it as reconciled.
3. The transaction records its reconciliation date (`reconciliation_date`) and updates the **Reconciled (Real) Balance** versus **Pending (Expected) Balance**.

*(Note: Statement balance verification with a 0.00 € equilibrium calculator is provided specifically within the CSV/XLSX Statement Import Wizard).*

### 4. Editing & Deleting Operations
- **Quick Edit**: Click any row to open the editing modal.
- **Batch Edit**: Select multiple rows to update categories or reconciliation status in a single action.
- **Deletion**: Delete button with confirmation prompt.
