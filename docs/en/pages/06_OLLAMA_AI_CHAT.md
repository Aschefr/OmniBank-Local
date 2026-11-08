# 🤖 Page Documentation: Local AI Chat (Ollama)

The **AI Chat** page provides a natural language conversational interface with your autonomous financial assistant. It operates 100% offline on your device via **Ollama**.

---

## 📸 Illustrations

![AI Chat Interface](../../../screenshots/07_chat_ia.png)
*Conversational AI chat interface with chat history and model selector.*

![AI Action Proposal](../../../screenshots/07_chat_ia_proposition_ia.png)
*Autonomous action proposal by AI (Function Calling with confirmation card).*

---

## 🛠️ Components & Features

### 1. Natural Language Financial Queries
Ask financial questions or request tailored insights:
- *"What was my biggest expense category last month?"*
- *"How much is left in my groceries budget?"*
- *"Can I afford to save $200 this month?"*

### 2. Recommended Models
The setup wizard (AI step) and **Configuration > AI Assistant** suggest three models. "Use" picks the model and sets its temperature and context; with Ollama, "Download" fetches it without the command line.

| Tier | Model | Graphics memory | Advisor answer | Download |
|---|---|---|---|---|
| Minimum | `gemma4:e4b` | about 3.5 GB | about 5 s | 9.6 GB |
| Recommended | `bonsai-2:27b` | about 9.2 GB | about 16 s | 8.3 GB |
| Top quality | `qwen3.8:27b` | about 17.5 GB | about 13 s | 17.7 GB |

Settings applied: temperature 0.2 and 32K context for all three.

This choice comes from a benchmark of 16 models on OmniBank's own tasks: naming and categorising bank labels, grouping categories into envelopes, and twelve questions to the advisor (right tools, exact figures, nothing made up, answer in your language). Times were measured on a 24 GB graphics card; without a graphics card, expect several times longer.

- **Minimum**: fits almost any recent graphics card; the advisor gets hard questions wrong more often.
- **Recommended**: the quality of a 27-billion-parameter model in about 9 GB, thanks to ternary weights. It answered all twelve advisor questions correctly, but groups envelopes less consistently.
- **Top quality**: the best overall result measured, for a 24 GB graphics card.

#### How these models were chosen
The same figures are shown in **Configuration > AI Assistant**, under the three cards. Benchmark of 6 November 2026: each task run twice, temperature 0.2, 32K context, RTX 3090 graphics card. Labels: category of 45 made-up labels; real statement: category of 120 labels from a real statement; envelopes: 22 categories to place; advisor: 12 questions on a demo profile. When the two runs differ, both results are given.

| Model | Rank | Labels /45 | Real statement /120 | Envelopes /22 | Advisor /12 | Answer | Memory |
|---|---|---:|---:|---:|---:|---:|---:|
| `qwen3.8:27b` | Top quality | 44 | 78–80 | 20 | 12 | 13 s | 17.5 GB |
| `bonsai-2:27b` | Recommended | 43 | 73–74 | 16–20 | 12 | 16 s | 9.2 GB |
| `gemma4:e4b` | Minimum | 41–42 | 64–66 | 21 | 9–10 | 5 s | 3.5 GB |
| `gemma4:31b` | Alternative | 44 | 87 | 21 | 12 | 23 s | 19.9 GB |
| `ministral-3:14b` | Not chosen | 41 | 56–57 | 20–22 | **6** | 5 s | 11.1 GB |
| `mistral-nemo` | Not chosen | 38 | 58 | 21 | **0–3** | 1.4 s | 9.9 GB |

- The advisor decides: `ministral-3:14b` and `mistral-nemo` file labels well, but get half the questions or more wrong, almost always without looking at your data. `gemma4:31b` reads a real statement best, but answers almost twice as slowly as `qwen3.8:27b`.
- `gemma4:e4b` fits in 3.5 GB and places envelopes well (21 out of 22); it gets 2 or 3 of the advisor's 12 questions wrong.

##### And the recommended settings
- 32K context: the advisor's instructions and tools already take about 9,000 tokens. 16K is the minimum accepted; 32K leaves room for the conversation history and large imports.
- Temperature 0.2: the benchmark value. It only sets the advisor and budget suggestions; categorisation and import always stay at 0.1.
- Thinking kept for the advisor (benchmark of 8 November 2026): without it, `gemma4:e4b` stops calling its tools and drops from 9 to 2 or 3 right answers out of 12, and `bonsai-2:27b` loses up to two. `qwen3.8:27b` loses nothing and answers in 7 to 8 s instead of 12: the switch in Configuration > AI Assistant > Advanced settings turns it off. The other AI tasks never think.

Any other installed model stays available in the dropdown. Prefer a model that can call tools: the advisor and data extraction need it.

### 3. Autonomous Function Calling Cards
When asking the AI to perform a management action (e.g., *"Add a $45 grocery expense today"*, *"Prepare a €280 bridge transfer from my Savings account to my Checking account"*, or *"Trigger a bank synchronization"*), the AI never mutates your database without explicit consent:
1. It prepares the structured tool function request:
   - `create_transaction`: Manual expense or income recording.
   - `create_planned_transfer`: Recording an unreconciled planned transfer between two of your accounts.
   - `set_budget`: Adjusting a category budget envelope ceiling.
   - `trigger_bank_sync`: Initiating an online statement fetch for configured bank connections.
2. The UI renders an interactive **Action Confirmation Card** with detailed arguments.
3. You approve the action by clicking **"Confirm"** (or cancel), keeping full manual control.

### 4. Bridge Transfers & Banking Boundaries (Strictly Offline & Read-Only)
OmniBank and its AI assistant adhere to a strict operational principle: **no external banking write operations are possible**.
- The application connects to financial institutions strictly in **read-only mode**. Neither the AI nor the app can move real funds or issue external wire transfers.
- When facing a cash shortfall or overdraft risk, the assistant guides you through a clear **3-step workflow**:
  1. **User Real Bank Transfer**: You execute the actual transfer on your bank's native mobile app or web portal.
  2. **OmniBank Planned Transfer Recording**: The assistant offers to immediately log this planned transfer in OmniBank (`create_planned_transfer`). Once approved, this instantly updates your projected balance and Reste à Vivre (RTL).
  3. **Automatic Statement Reconciliation**: Once your bank clears the transfer, the next online statement sync (triggered via the AI's `trigger_bank_sync` tool, manually, or via Auto-Pilot) automatically detects and reconciles the real bank transaction against your planned entry with zero duplication.

---

## 🔒 Data Privacy Guarantee

> [!IMPORTANT]
> No financial records, description labels, or monetary values leave your computer. RAG prompts are sent strictly to the local Ollama instance on `127.0.0.1`.
