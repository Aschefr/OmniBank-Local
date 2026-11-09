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
The same figures are shown in **Configuration > AI Assistant**, under the three cards. Benchmark of 6 November 2026: 16 models, each task run twice, temperature 0.2, 32K context, RTX 3090 graphics card. The score out of 10 measures quality only: advisor 40% (12 questions on a demo profile: right tools, exact figures, nothing made up), real statement 30% (category of 120 real labels), labels 15% (45 made-up labels), envelopes 15% (22 categories to place). Speed and memory do not count in it.

| Model | Rank | Score /10 | Advisor /12 · 40% | Real statement /120 · 30% | Labels /45 · 15% | Envelopes /22 · 15% | Minimum card | Memory | Answer |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `gemma4:31b` | Alternative | **9.1** | 12 | 87 | 44 | 21 | 24 GB and more | 21.3 GB · Q4 | 23 s |
| `qwen3.8:27b` | Top quality | **8.8** | 12 | 78–80 | 44 | 20 | 24 GB and more | 18.7 GB · Q4 | 13 s |
| `bonsai-2:27b` | Recommended | **8.5** | 12 | 73–74 | 43 | 16–20 | 12 GB | 9.5 GB · Q2 | 16 s |
| `qwen3.6:27b` | too slow | 8.2 | 11 | 69 | 41 | 20–21 | 24 GB and more | 18.6 GB · Q4 | 40 s |
| `mimo-v2.6:9b` |  | 7.8 | 9–11 | 69–70 | 40 | 20–21 | 8 GB | 7.0 GB · Q4 | 7 s |
| `qwen3.5:9b` | Not chosen · real statement 59/120 | 7.8 | 11 | **59–61** | 38–40 | 20 | 8 GB | 7.0 GB · Q4 | 8 s |
| `qwen3.5:4b` | Not chosen · real statement 57/120 | 7.7 | 11 | **57–58** | 38 | 19–20 | 8 GB | 4.5 GB · Q4 | 6 s |
| `gemma4:e4b` | Minimum | **7.6** | 9–10 | 64–66 | 41–42 | 21 | 8 GB | 4.9 GB · Q4 | 5 s |
| `nemotron-3.5-bolt:e4b` | Not chosen · advisor 8/12 | 7.6 | **8–10** | 68–69 | 41 | 22 | 12 GB | 7.9 GB · Q4 | 6 s |
| `gemma4:12b` | Not chosen · advisor 7/12 | 7.5 | **7–10** | 72–74 | 44 | 20 | 12 GB | 9.1 GB · Q4 | 10 s |
| `bonsai-2:9b` | Not chosen · real statement 53/120 | 7.4 | 10–12 | **53** | 34–35 | 16–20 | 8 GB | 4.2 GB · Q2 | 7 s |
| `gemma4:e2b` | Not chosen · advisor 6/12 | 6.4 | **6–8** | 54–60 | 42 | 18–19 | 8 GB | 3.5 GB · Q4 | 3.5 s |
| `ministral-3:14b` | Not chosen · advisor 6/12 | 6.2 | **6** | 56–57 | 41 | 20–22 | 16 GB | 11.5 GB · Q4 | 5 s |
| `ministral-3:8b` | Not chosen · advisor 6/12 | 6.1 | **6** | 57–59 | 42 | 18 | 12 GB | 8.2 GB · Q4 | 2.2 s |
| `lfm3:1.7b` | Not chosen · real statement 0/120 | 4.6 | 9–10 | **0** | 23 | 10 | 8 GB | 1.7 GB · Q4 | 12 s |
| `mistral-nemo` | Not chosen · advisor 0/12 | 4.6 | **0–3** | 58 | 38 | 21 | 12 GB | 9.5 GB · Q4 | 1.4 s |

- **Not chosen**: fewer than 9 right answers out of 12 from the advisor, or a task under half its score, in either of the two runs. The task at fault is shown in the Rank column and in bold.
- **Top quality**: the best score among models that answer in under 20 s. **Alternative**: the best score with no time limit. **Minimum** and **Recommended**: the models advised for small and medium cards, below.
- Within 0.3 points, the lighter model wins: two runs cannot tell models apart more finely. That is why `gemma4:e4b` (4.9 GB) comes before `mimo-v2.6:9b` (7.0 GB) on an 8 GB card.
- Memory: used on the graphics card once the model is loaded, measured with nvidia-smi; Ollama's default version (quantisation shown when known), 32K context, 8-bit context cache (q8_0) with flash attention. With Ollama's default cache (16-bit), allow up to 0.5 GB more. Answer: the advisor's median time.

##### Your graphics card → advised model
| Graphics card | Advised model |
|---|---|
| 8 GB | `gemma4:e4b` |
| 12 GB | `bonsai-2:27b` |
| 16 GB | `bonsai-2:27b` |
| 24 GB and more | `qwen3.8:27b` |

A model fits a card if its memory is at most the card's size minus 1 GB. A model that is too big still works, partly in system memory, but much more slowly.

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
