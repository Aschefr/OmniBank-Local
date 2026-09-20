# 🎯 Page Documentation: Budgets, Envelopes & Auto-Pilot

The **Budgets** page manages personal finances using the **Budget Envelope Method**. It pairs real-time visual progress monitoring with a local-first **Budget Auto-Pilot** engine capable of discovering orphan categories, enriching existing envelopes, and suggesting smoothed monthly recalibrations, operating 100% autonomously or assisted by a local AI model.

---

## 📸 Illustrations

![Budgets Page](../../../screenshots/05_budgets.png)
*General overview of budget envelopes.*

![Budget Detail](../../../screenshots/05_budgets_detail.png)
*Detailed view of an envelope's consumption and associated transactions.*

![Budget Edit](../../../screenshots/05_budgets_detail_edition.png)
*Modal for editing and locking budget envelope caps.*

![Ollama AI Suggestions](../../../screenshots/05_budgets_suggestion_ia.png)
*Budget recommendation module and interactive review modal.*

---

## 🛠️ Principles & Visual Features

### 1. The Budget Envelope Method
A budget envelope represents an **intentional monthly spending ceiling** assigned to one or more expense categories (e.g., *Food & Groceries*, *Mobility & Fuel*, *Leisure & Outings*).
- **Three-tier dynamic progress bar:**
  - 🟢 **Green (0% to 80%):** Spending pace under control.
  - 🟠 **Orange (81% to 99%):** Attention threshold reached, approaching ceiling.
  - 🔴 **Red (≥ 100%):** Budget exceeded.
- **Remaining balance:** Real-time calculation of remaining amount and consumed percentage.

### 2. Side Panel for Transaction Inspection
Clicking on an envelope card opens a contextual side panel without navigating away. It exhaustively lists all actual transactions recorded during the current month for the envelope's categories, letting you quickly spot cost drivers.

### 3. Sanitized Envelope Locking (`🔒`)
Any envelope can be locked via its edit modal. A locked envelope:
- Displays a prominent lock icon `🔒`.
- Is **strictly quarantined**: the Auto-Pilot engine is prohibited from proposing any ceiling changes (ideal for fixed, non-negotiable costs like rent, mortgage, or insurance).

### 4. Zero-F5 Reactivity (100% Real-Time)
The budget interface is fully reactive: creating envelopes, validating suggestions, closing, or editing immediately updates the view via internal DOM `CustomEvent` hooks without ever requiring a manual page refresh (F5).

---

## 🤖 The Budget Auto-Pilot & Automations Module

Accessible from the top toolbar via the **`⚙️ Automations`** button or directly from the suggestions notification banner, this module governs the application's budget intelligence.

### 1. Choice of Suggestion Engine
Users can select their preferred analysis engine:
* **⚙️ Deterministic Engine (Default, Recommended):**
  - Runs **100% offline**, with zero hardware requirements or network calls.
  - Instantaneous (< 50 ms) execution via statistical Winsorizing and thematic clustering algorithms.
* **🤖 Local AI-Assisted Engine (Ollama):**
  - Powered by a local Ollama instance running on your machine (e.g., `gemma4:e4b`, `mistral`, `llama3`).
  - Semantically analyzes category descriptions to create natural groupings.
  - **Zero-crash automatic fallback:** If Ollama is offline or unavailable, the system silently and seamlessly falls back to the deterministic engine without throwing errors or interrupting workflow.

---

## 🧠 Two-Pillar Algorithmic Architecture

The budget Auto-Pilot evaluates finances across two distinct, safeguarded pillars:

### Pillar A: Envelope Discovery & Intelligent Enrichment

Pillar A inspects expense categories currently not covered by any active envelope (*orphan categories*).

1. **Intelligent Envelope Enrichment:**
   - Instead of cluttering your dashboard with redundant micro-envelopes (e.g. creating an isolated envelope for "Bakery" when "Food & Groceries" already exists), the engine identifies thematic affinity.
   - It proposes to **attach the orphan category to an existing envelope** and adjust its ceiling by the observed monthly average.
2. **Cohesive Envelope Creation:**
   - For orphan categories without an existing thematic match, the engine groups related categories together (e.g. *Mobility* grouping *Gasoline*, *Tolls*, *Parking*).
3. **🛡️ The One-Off Expense Safeguard ($\ge 2$ Observed Months):**
   > [!IMPORTANT]
   > **Golden Rule of Rest-to-Live Protection:**
   > To qualify for envelope creation or enrichment, an expense category must show debits across **at least 2 distinct calendar months**.
   > 
   > **Why is this safeguard essential?**
   > If the algorithm created a monthly envelope for an isolated, one-time purchase (such as a €1,500 home appliance or an isolated €50 birthday gift that occurred only once), it would establish a recurring phantom expense that **artificially reduces your monthly Rest to Live balance forever**. The system requires proof of an ongoing habit before proposing a recurring budget.
4. **Configurable Floor Threshold:**
   - Default set to **€30.00**, preventing unnecessary budget proposals for negligible minor expenses.
5. **Persistent Rejection (`DISMISSED`):**
   - Dismissing a suggestion (`[Dismiss]`) permanently records the decision in the audit log. The category will never be suggested again in future analyses.

---

### Pillar B: Smoothed Monthly Recalibration (EMA Smoothing)

Pillar B monitors active spending envelopes to gently adapt ceilings to changing lifestyle realities.

1. **Anti-Thrashing Periodic Cadence:**
   - Recalibration evaluations run automatically on the **1st of each month** or upon pay cycle rollovers.
   - They can also be triggered at any time on demand using the **`⚡ Run Analysis`** button.
2. **Exponential Moving Average (EMA) Formula:**
   - To prevent jarring fluctuations, suggested adjustments are smoothed over a 3 to 6-month lookback window with an inertia factor $\alpha = 0.20$:
     $$\text{Suggestion}_{t} = (1 - \alpha) \cdot \text{Budget}_{\text{current}} + \alpha \cdot \overline{\text{Spending}}_{\text{historical}}$$
   - Historical spending values are pre-processed using **Winsorizing** to filter out temporary spending spikes (e.g. an unusual travel dinner).
3. **Double Drift Guard:**
   - **Monthly limit:** A suggested adjustment can never exceed $\pm 10\%$ from one month to the next.
   - **Annual limit:** Cumulative drift cannot exceed $\pm 25\%$ relative to the reference annual budget (`base_annual_amount`).
4. **$\pm 2\%$ Significance Threshold:**
   - If the difference between the current budget and the smoothed projection is under 2%, no recommendation is made, eliminating trivial cent-level noise.
5. **Absolute Quarantines:**
   - **Savings** envelopes (`savings`), **Project** envelopes (`is_project`), annual envelopes, and **Locked** envelopes (`is_locked`) are strictly excluded from automated recalibrations.

---

## 💬 Understanding Notifications & System Responses

When clicking **`⚡ Run Analysis`** in the automations dialog:

### 1. Info Toast: *"ℹ️ No adjustment or new envelope needed at this time."*
This message signifies that your budget setup is **healthy, stable, and optimal**. It triggers when:
- **Existing envelopes are properly calibrated:** Your actual spending closely aligns with your ceilings (variance $< 2\%$).
- **Unbudgeted expenses are strictly isolated:** All unbudgeted categories only appear in a **single calendar month**. Under the $\ge 2$ months safeguard, the system refuses to establish an unnecessary permanent budget for a one-time charge.

### 2. Success Toast: *"{count} budget recommendation(s) identified"*
This indicates actionable, vetted observations:
- A genuine, prolonged shift in spending habits warrants an envelope ceiling update.
- A new recurring expense pattern has persisted across at least 2 distinct months and merits an envelope attachment or new budget.

---

## 📋 Interactive Suggestion Review Dialog

When recommendations are generated, a subtle banner appears on the Budgets page. Clicking **`Review Suggestions`** opens an interactive dialog:

### 1. Visual Comparison Elements
- **Origin badge:** `⚙️ Deterministic`, `🤖 Local AI`, or `🔗 Enrichment`.
- **Numerical diff:** Current amount $\to$ Suggested amount with percentage delta ($\Delta\%$).
- **Explanation:** Plain-text financial reasoning explaining why the change is recommended.
- **Category breakdown:** Subcategories included along with their observed historical averages.

### 2. Available Actions
- **`[Apply]` (1-click):** Applies the adjustment or creates the envelope structure immediately, backed by full Undo/Redo tracking.
- **`[Dismiss]`:** Permanently rejects the recommendation and logs it as `DISMISSED`.
- **`[Apply All]`:** Approves all proposed recommendations in the batch in one step.

### 3. Mobile Responsive Layout
On mobile devices and tablets, the review dialog adapts responsively:
- Stacked touch cards with smooth vertical scrolling.
- Fixed `✕` close button anchored top-right.
- Full-width touch buttons optimized for thumb navigation.

---

## 🔒 Sovereignty, Auditing & Traceability

- **Zero Cloud & Local Data:** All statistical analyses, clustering, and Ollama queries execute 100% on your machine. Financial transactions, amounts, and metadata never leave your device.
- **Decision Audit Log (`AutopilotDecisionLog`):** Every suggestion generated, applied, or rejected is stamped and stored in the local SQLite database with its complete `snapshot`, ensuring complete transparency and accountability.
