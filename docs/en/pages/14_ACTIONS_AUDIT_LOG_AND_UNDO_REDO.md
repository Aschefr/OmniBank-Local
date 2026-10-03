# 🕓 Documentation Page: Actions Audit Log & Undo / Redo

The **Actions Audit Log** (`static/js/views/history_manager.js`) and the global **Undo / Redo** engine provide end-to-end auditability and instant reversibility for every change performed across OmniBank Local.

---

## 🎯 1. Vision & Absolute Reversibility Guarantee

OmniBank Local enforces a strict accounting safety guarantee:
- **Zero Irreversible Destructive Actions**: Every creation, update, deletion, or reconciliation step records a complete before/after snapshot (JSON delta) into the local SQLite `action_history` table.
- **Stress-Free Operations**: An accidentally deleted operation, a mistyped figure, or an incorrect category assignment can be reversed in milliseconds.

---

## ⌨️ 2. Global Undo / Redo (Shortcuts & Header Buttons)

In the application's top navigation header, two dedicated controls allow instant undoing and redoing of actions:

- ↩️ **Undo Button (`#headerUndoBtn`)** or keyboard shortcut **`Ctrl + Z`** (or `Cmd + Z` on macOS):
  - Immediately undoes the latest mutation performed across the application (transaction deletion, category reassignment, budget edit, etc.).
  - Restores the exact prior state in the SQLite database and dynamically refreshes the UI without requiring a full page reload.
- ↪️ **Redo Button (`#headerRedoBtn`)** or keyboard shortcut **`Ctrl + Y`** (or `Ctrl + Shift + Z`):
  - Re-applies the action that was just rolled back.
- **Interactive Toast Notification**: A transient confirmation popup appears at the bottom of the screen with a quick action button to undo changes on the spot.

---

## 🏛️ 3. Dedicated View: Actions Log (`history`)

Accessible from the main navigation menu via the **🕓 Actions** button, this view presents a complete chronological ledger of every mutation recorded in the database.

### A. Chronological Event Table
For each audit log entry, the table specifies:
- **Timestamp**: Exact date and time down to the second.
- **Entity**: The impacted data model (Transaction, Budget, Category, Account, Recurrence, Auto-Pilot Rule).
- **Action Type**:
  - 🟢 `CREATE`: Insertion of a new record.
  - 🟡 `UPDATE`: Mutation of one or more attributes.
  - 🔴 `DELETE`: Removal of an existing record.
  - 🔵 `RECONCILE`: Check/uncheck reconciliation state.
  - 🟣 `BATCH_ACTION`: Bulk operation or autonomous system mutation.
- **Author (Organization Mode)**: Name or badge of the user who initiated the change (e.g., *Treasurer*, *President*).
- **Summary**: Concise description of the modification (e.g., *“Changed amount from €45.00 to €50.00 on CARREFOUR”*).
- **Targeted Action Button**: Individual **"Undo"** button to selectively revert a specific past action from the log.

### B. Snapshot Diff Inspection Modal
Clicking on any log row opens a detailed before/after diff inspector:
- **Prior Values (Red)**: Attribute values before the mutation.
- **New Values (Green)**: Attribute values applied after the mutation.

---

## 👥 4. Organization Mode & Multi-User Traceability

When operating under an association or works council structure (Organization Mode with a valid license key):
- Every mutation records the currently active user profile selected in the header (`created_by`, `modified_by`).
- The log provides definitive proof of who approved a wire transfer, adjusted an envelope cap, or reconciled an official bank statement.
- Audit data remains strictly local in the `omnibank.db` SQLite database and is fully preserved during system backup exports.

---

## 🔍 5. Search & Advanced Filtering

The top toolbar allows fast inspection of large histories:
- **Filter by Entity**: Narrow down to transactions, budgets, or accounts.
- **Filter by Action**: Display deletions (`DELETE`) to quickly find and recover missing records.
- **Filter by Period**: Today, Past 7 Days, Past 30 Days, or custom date ranges.
- **Text Search**: Search by merchant, description, or monetary amount.

---

## 💡 Tips & Best Practices

> [!TIP]
> If you accidentally delete a parent category with several subcategories, press **Ctrl + Z** immediately: the complete tree and its transaction associations will be restored instantly.

> [!NOTE]
> The audit log is engineered for scale: JSON snapshots are compressed and indexed to guarantee sub-10ms response times even when browsing tens of thousands of historic actions.
