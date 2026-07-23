# 🔁 Page Documentation: Recurrences & Schedule

The **Recurrences** page automates periodic income and expense management (subscriptions, rent, salaries, utility bills, insurance, recurring transfers) via templates (`RecurrenceTemplate`) and a dual-mode visualization engine.

---

## 📸 Illustrations

![Recurrences Overview](../../../screenshots/08_recurrences.png)
*General overview of recurrence templates in Table mode.*

![Editing a Recurrence](../../../screenshots/08_recurrences_modification.png)
*Modal for editing recurrence template parameters.*

![Recurrence Propagation](../../../screenshots/08_recurrences_modification_propagé.png)
*Updating recurrence template parameters and regenerating upcoming transactions.*

---

## 🛠️ Components & Features

### 1. Global Recurrence KPIs
At the top of the view, summary cards track recurring commitments for the selected year:
- **Total Fixed Expenses** (monthly / annual).
- **Total Recurring Income**.
- **Net Recurring Balance**: $$\text{Recurring Income} - \text{Fixed Expenses}$$

### 2. Dual Display Modes (Table vs Gantt Timeline)

Switch between two display modes using the top-right toggle buttons:

#### 📋 Table View (`viewModeTable`)
- Displays a structured list of recurrence templates: Description, Account(s), Category, Frequency, Amount, Next due date, and Active status (`is_closed`).
- Enables editing, deleting, closing, or reopening templates.

#### 📅 Gantt Timeline View (`viewModeTimeline`)
- Renders an interactive chronological **Gantt chart** spanning the 12 months of the selected year.
- Each recurrence row shows monthly segments with dynamic color coding:
  - 🔵 **Blue Segment (Pending)**: Scheduled expected occurrence not yet reconciled.
  - 🟢 **Green Segment (Reconciled)**: Confirmed occurrence reconciled against bank statement.
  - ⚪ **Hatched Segment (Skipped)**: Paused or skipped occurrence (`is_skipped`).
- **Direct Segment Click**: Clicking any segment opens a popover for quick actions (instant reconciliation, skip occurrence, etc.).

### 3. Advanced Filters & Search
- **Duration Filters**: All, Unlimited duration, or Limited duration (with end date).
- **Frequency Filters**: Filter by periodicity (Monthly, Bi-Monthly, Quarterly, Semi-Annually, Yearly).
- **Keyword Search**: Real-time filtering across titles and descriptions.
- **Year Navigation (`< YYYY >`)**: Navigate between years to inspect history or future projections.

### 4. Automated Projection & Smart Regeneration
- **Rolling Auto-Projection**: Expected transactions are automatically generated in the background based on a configurable advance horizon (`recurrence_generation_months`, defaulting to 12 months). No manual renewal step is required.
- **Smart Regeneration on Edit**: Modifying a template (e.g., updating rent amount or due day) causes the backend (`app/routers/recurrences.py`) to delete and regenerate **unreconciled** expected transactions across the projection window, while **protecting past reconciled transactions** (`reconciliation_date != null`) completely.
