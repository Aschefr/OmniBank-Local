# 📊 Page Documentation: Cockpit and Ledger

OmniBank Local offers two complementary views of the current cycle (from one payday to the next):

| View | Purpose | Access |
|---|---|---|
| **🎛️ Cockpit** | The essentials at a glance: remaining budget, reconciled spending, spending pace, net worth. The app's **home screen**. | Main menu, logo click, mobile tab |
| **📒 Ledger** | The cycle's list of operations, to enter, reconcile and filter. | Main menu, mobile tab |

The Cockpit is always available: it cannot be disabled in Configuration.

> [!NOTE]
> The former **Dashboard** has been retired. Its information now lives elsewhere: net worth on the Cockpit, operations to reconcile in the Ledger, averages & pace and the top 6 expenses in **Trends**, budgets and savings in **Budgets**.

---

## 📸 Illustrations

![Operations Ledger](../../../screenshots/02_dashboard.png)
*The Ledger: the cycle's operations, balances and reconciliation.*

![Quick Operation Entry](../../../screenshots/02_dashboard_saisie_operation.png)
*Modal for quickly creating a new transaction.*

---

## 🎛️ 1. The Cockpit

A simplified view for a quick daily check:
- **Remaining budget**: ring gauge of the share left and amount left out of the cycle's initial remaining budget.
- **Reconciled spending**: share of expected expenses already reconciled, and what is still to come.
- **Spending pace (€/day)**: needle gauge comparing your daily spending to your average, with a verdict (e.g. "On track").
- **Net worth**: total of your accounts and savings (or the selected account's balance); one click opens Accounts.
- **End-of-cycle projection**: forecast balance at the next payday.
- **Auto-Pilot** and **To reconcile**: Auto-Pilot status, operations to review and number of operations awaiting reconciliation (one click opens the Ledger).
- **Next month outlook**: expected income, fixed charges, estimated variable spending and estimated net margin, with a link to the Simulator.

The Cockpit header offers an account selector, the Auto-Pilot status and the **New transaction** button.

## 📒 2. The Ledger

The current cycle's list of operations, the everyday working tool:
- **Columns**: date, description, category, amount, reconciliation and actions; more columns (accounts, envelope, recurrence, attachments…) can be enabled with the **Columns** button.
- **Filters**: search, period, type, category and "Unreconciled before pay".
- **Actions**: **Import statement**, **Fetch online** (when a bank is connected), **Automations** and **New transaction**. On mobile, the first three are in the **⋯** menu, the filters sit behind the **Filters** button (showing how many are active) and **New transaction** is the round **＋** button at the bottom right. History works the same way.
- **Reconciliation**: a **Reconcile** button on each operation; reconciled operations are dimmed and show their reconciliation date. On mobile each operation fits on two lines: a round **✓** button reconciles, tapping the card opens the edit form (with **Duplicate**, **Skip** and **Delete**), the account appears as its colour dot and the 🔁 📎 🗂️ icons flag recurrence, attachment and envelope.
- **Period bar**: navigate between cycles (◀ 📅 ▶) and **Close current month**. On desktop it sits at the bottom of the list; on mobile it opens in the header from the **📅 Period** button.

To browse every operation across all periods, use **History**.

## ➕ 3. Quick Entry (New transaction)

The **New transaction** button opens the creation modal:
- **Account(s)**: "From" and/or "To" depending on direction (expense, income or transfer).
- **Amount** and **date**.
- **Description** and **category**.
- **Reconciliation status**: checked or not.

On mobile the form opens in a phone-sized window: amount, description, "From" and "To" accounts side by side ("—" for no account), date and category, then **More options** for recurrence, envelope, reconciliation date, slip and attachments (opened automatically when the operation uses them). The header **⋯** menu holds Auto-Pilot mode, Duplicate, Skip and Delete.

## 🤖 4. Auto-Pilot Widget

The Cockpit shows the Auto-Pilot status:
- **Live status**: active or on standby.
- **Operations to review**: number of decisions awaiting your review.
- **Quick access to the Auto-Pilot Control Center**.

## 🧭 5. Navigation and Header Controls

- **On desktop**: horizontal menu at the top of the screen.
- **On mobile**: tab bar at the bottom of the screen (Cockpit, Ledger, Auto-Pilot, AI Chat when enabled, and **More** for every other view).
- **Undo / Redo**: ↩️ / ↪️ (or `Ctrl+Z` / `Ctrl+Y`) to undo or redo any accounting action.
- **Notification center (🔔)**: budget alerts, AI reports and due-date reminders.
- **Profile switcher**: switch between your profiles (e.g. *Personal finances*, *Association*).
- **Privacy mode (👁️)**: hides amounts (`••• €`) in public places.
- **Themes**: Classic dark and light, Titanium dark and Alabaster light.

---

## 💡 Tips & Best Practices

> [!TIP]
> Start the day on the Cockpit: the remaining budget and the spending pace tell you at a glance where you stand. Then move to the Ledger to reconcile new operations.
