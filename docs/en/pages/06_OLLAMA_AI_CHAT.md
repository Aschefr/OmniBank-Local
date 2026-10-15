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

### 2. Supported Models & Auto-Detection
The interface automatically queries locally installed LLMs via Ollama (`http://localhost:11434/api/tags`):
- **`gemma4:e4b`** (⭐ Recommended — Main model used and tested during OmniBank development)
- **Mistral 7B**
- **Llama 3 / Llama 3.1**
- **Qwen 2.5**
- **Phi-3 / Gemma**

Switch between available models anytime using the top-right dropdown.

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
