# 📊 Page Documentation: Dashboard

The **Dashboard** is OmniBank Local's main landing screen. It provides an immediate overview of overall financial health, account balances, recent transactions, and quick action shortcuts.

---

## 📸 Illustrations

![Dashboard Main Screen](../../../screenshots/02_dashboard.png)
*General overview of the Dashboard with balance cards, charts, and recent operations.*

![Quick Operation Entry](../../../screenshots/02_dashboard_saisie_operation.png)
*Modal for quickly creating a new transaction.*

---

## 🛠️ Components & Features

### 1. Balance Summary Cards
At the top of the page, key balance metrics display:
- **Total Reconciled (Real) Balance**: Sum of all confirmed balances matching official bank statements.
- **Total Pending (Expected) Balance**: Balance including entered operations that have not yet been reconciled.
- **Monthly Variation**: Total income minus total expenses for the active month.

### 2. Balance Evolution Chart
An interactive chart (powered by **Chart.js**) plots balance trends across the days of the selected month, highlighting spending spikes and income events visually.

### 3. Recent Transactions Table
A preview of recent transactions allowing you to:
- View date, description, payee, and amount.
- See assigned category colors.
- Quickly toggle reconciliation status.

### 4. Quick Operation Entry (+ New Operation)
The **"+ New Operation"** button opens the creation modal:
- **Account**: Target account selection.
- **Type**: Expense (Fixed or Variable), Income, or Transfer.
- **Amount & Date**: Exact numerical value and date.
- **Description & Payee**: Transaction details and merchant/organization name.
- **Category**: Category and subcategory selection.
- **Reconciliation Status**: Mark as reconciled or pending.
