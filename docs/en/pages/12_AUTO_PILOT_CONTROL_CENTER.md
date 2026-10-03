# 🤖 Documentation Page: Auto-Pilot & Control Center

The **Auto-Pilot** is OmniBank Local's autonomous and sovereign financial automation engine. It transitions the user from repetitive manual data entry to informed supervisory oversight: the application categorizes, reconciles, dynamically adjusts budgets, and discovers recurring patterns automatically and safely without any cloud dependency.

---

## 🎯 1. Vision & Core Principles

The Auto-Pilot is founded on four foundational principles:

1. **Total Sovereignty (Zero Cloud)**: All decision engines (merchant normalization rules, statistical EMA models, and local Ollama inference) run exclusively on your physical machine.
2. **Post-Action Paradigm (Zero Blocking Modals)**: High-confidence operations are committed immediately to keep balances and *Safe-to-Spend / Free Cash Flow* up-to-date in real time.
3. **Full Reversibility (1-Click Rollback)**: Every autonomous decision is recorded in an immutable decision log (`autopilot_decision_logs`) and can be reverted in a single click.
4. **Gradual Control Levels**: Users can alternate between **Monitoring Mode** (suggestions only) and **Active Mode** (controlled autonomy backed by safety circuit breakers).

---

## 🧭 2. Operational Modes

| Mode | Behavior | Ideal Use Case |
| :--- | :--- | :--- |
| **⏸️ Monitoring Mode (Suggestions)** | Auto-Pilot processes statement streams, computes confidence scores, and enqueues suggestions without mutating the database directly. | Onboarding phase, verifying merchant labeling rules before granting full autonomy. |
| **🚀 Active Mode (Autonomous)** | High-certainty transactions (≥ 85%) are automatically categorized and reconciled. Ambiguous entries are committed with a `needs_review` flag. | Day-to-day effortless, friction-free operation. |

---

## 🎛️ 3. The Cockpit Widget (Dashboard & Overview)

On the **Dashboard** and **Overview** screens, a sliding drawer **Auto-Pilot Cockpit** provides instant operational status:

- **State Indicator**: Colored badge showing Green (Active) or Muted Gray (Monitoring).
- **Active Rules**: Total count of merchant patterns and learned mappings (`bank_label_mappings`).
- **Pending Review**: Badge showing the number of transactions waiting for manual review.
- **"⚡ Run Auto-Pilot" Button**: Manually triggers an end-to-end analysis cycle across all accounts.
- **"Open Control Center" Shortcut**: Directly navigates to the dedicated full-screen Auto-Pilot view.

---

## 🏛️ 4. Dedicated View: Control Center (`autopilot`)

Accessible via the main navigation bar (**🤖 Auto-Pilot**), the Control Center provides complete oversight and auditing tools:

### 📊 A. Top KPI Cards
1. **Automation Rate**: Percentage of overall operations handled autonomously without manual entry.
2. **Total Decisions**: Aggregate count of decisions executed since Auto-Pilot activation.
3. **Review Queue**: Number of items flagged with `needs_review = True`.
4. **Budget Optimizations**: Recalibrations and savings suggestions surfaced by the statistical engine.

### 📜 B. Decision Feed
A chronological timeline itemizing each automated action:
- **Decision Nature**: Auto-categorization, transaction reconciliation, recurrence discovery, envelope budget recalibration, or auto-closure.
- **Confidence & Rationale**: Algorithmic affinity score and reasoning (e.g., *96% - Merchant rule "CARREFOUR MARKET"*).
- **Before/After Snapshot**: Previous state versus the newly applied mutation.
- **"Revert" Button (1-Click Rollback)**: Atomically rolls back the transaction or budget change to its previous state.

### 📥 C. Post-Action Review Queue
Displays operations where the algorithm detected ambiguity (confidence score between 60% and 84%, or transaction amount exceeding standard safety limits):
- **1-Click Validation**: Approves the Auto-Pilot's recommendation.
- **Quick Re-categorization**: Selects an alternate category directly in line.
- **Auto-Rule Creation**: Persists the merchant pattern to streamline all future imports.

### ⚙️ D. Safety Limits & Circuit Breakers
- **Maximum Transaction Amount Cap**: Any single transaction exceeding this threshold (e.g., €500) is quarantined to the Review Queue.
- **Reconciliation Confidence Threshold**: Defaulted to 85% to prevent false-positive matching.
- **Budget Recalibration EMA**: Exponential moving average smoothing over 3 to 6 months to prevent seasonal anomalies from permanently altering spending limits.

---

## 💡 Tips & Best Practices

> [!TIP]
> Check the Review Queue once a week: validating or re-assigning a transaction immediately updates the merchant mapping table (`bank_label_mappings`), continually increasing Auto-Pilot precision over time.

> [!NOTE]
> In case of accidental operations or faulty imports, the global **Undo button (Ctrl+Z)** or the **Rollback** button in the Decision Feed restores prior states in milliseconds.
