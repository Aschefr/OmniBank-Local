# 📈 Page Documentation: Analytics Synthesis & PDF Export

The **Analytics Synthesis** page provides a consolidated matrix view of your finances over a chosen timeframe (3, 6, 12, or 24 rolling months, specific calendar year, or custom date range). It breaks down income and expenses by type and category in a multi-month comparative matrix and exports formal PDF reports.

---

## 📸 Illustrations

![Analytics Synthesis](../../../screenshots/04_synthèse.png)
*Category x Month matrix view of financial synthesis.*

![PDF Export Preview](../../../screenshots/04_synthèse_export_pdf.png)
*Generating the PDF financial report.*

![PDF Export Print Dialog](../../../screenshots/04_synthèse_export_pdf_print.png)
*System print / PDF save interface for the synthesis report.*

---

## 🛠️ Components & Features

### 1. Category × Month Analytical Matrix
Synthesis data is structured as an interactive matrix grid organized into clear sections:
- **🛍️ Variable Expenses**: Groceries, leisure, clothing, etc.
- **📋 Fixed Expenses**: Rent, subscriptions, insurance, taxes.
- **💰 Income**: Salary, benefits, sales.
- **🔁 Transfers & Internal Movements**: Money moved between your own accounts. Dedicated internal transfer tables display full annual transfer volumes even when viewing "All Accounts", allowing precise movement tracking while keeping global Net Income (`Income - Expenses`) calculations completely neutral.

Each parent category displays with expandable subcategories. Every row provides monthly breakdown sums, **Annual Totals**, and **Monthly Averages**.

### 2. Filters & Custom Range Selection
- **Account Selector**: Filter by a specific bank account or aggregate all accounts.
- **Reconciliation Filter**: All amounts, Reconciled operations only, or Unreconciled operations only.
- **Timeframe Selector**: 3, 6, 12, or 24 rolling months, or specific calendar year selection.
- **Custom Date Range**: Toggle custom period inputs to set start and end dates down to the exact day.
- **Years Selector (⚙️ Years)**: Comparative multi-year popover.

### 3. PDF Report Generation & Export
For personal record-keeping, accounting needs, or association/CSE reporting (Organization Mode):
1. Click **"📥 Export to PDF"**.
2. Configure report parameters in the modal (column selection, operation types, orientation).
3. OmniBank builds a clean print layout stripped of web navigation buttons.
4. Use the system print dialog to save as a PDF document.
