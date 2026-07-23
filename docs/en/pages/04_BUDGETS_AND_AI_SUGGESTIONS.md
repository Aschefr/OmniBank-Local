# 🎯 Page Documentation: Budgets & AI Suggestions

The **Budgets** page manages spending using **Budget Envelopes**. It combines real-time visual progress tracking with a local artificial intelligence module (**Ollama**) capable of recommending tailored envelope cap adjustments.

---

## 📸 Illustrations

![Budgets Page](../../../screenshots/05_budgets.png)
*General overview of budget envelopes.*

![Budget Detail](../../../screenshots/05_budgets_detail.png)
*Detailed view of an envelope's consumption and associated transactions.*

![Budget Edit](../../../screenshots/05_budgets_detail_edition.png)
*Modal for editing budget envelope caps.*

![Ollama AI Suggestions](../../../screenshots/05_budgets_suggestion_ia.png)
*AI budget recommendation module powered by local Ollama.*

---

## 🛠️ Composants & Features

### 1. Monthly Budget Envelopes
For each category (e.g., *Groceries*, *Leisure*, *Fuel*):
- Assign a monthly spending cap (e.g., $400).
- Monitor progress bars:
  - 🟢 **Green** (0% - 80%): Budget under control.
  - 🟠 **Orange** (81% - 99%): Approaching cap limit.
  - 🔴 **Red** (≥ 100%): Budget exceeded.

### 2. Viewing Linked Transactions
Clicking an envelope card opens a side panel listing all transactions recorded during the active month for that category, letting you identify cost drivers quickly.

### 3. Local AI Budget Suggestions (Ollama)
When clicking **"AI Suggestions"**:
1. The backend service (`app/services/budget_ai_service.py`) analyzes your actual spending history over recent months.
2. The local Ollama model (**`gemma4:e4b`**) computes weighted averages per category while respecting seasonality.
3. It generates realistic budget cap proposals with detailed explanations.
4. You can apply all recommendations with a single click or tweak values individually before saving.
