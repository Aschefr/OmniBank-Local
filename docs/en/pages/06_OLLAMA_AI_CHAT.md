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
When asking the AI to perform a management action (e.g., *"Add a $45 grocery expense today"*), the AI never mutates your database without explicit consent:
1. It builds a structured tool function request (`create_transaction`) decoding amounts, dates, and categories.
2. The UI renders an interactive **Action Confirmation Card**.
3. You approve the action by clicking **"Confirm"** (or cancel), keeping full manual control.

---

## 🔒 Data Privacy Guarantee

> [!IMPORTANT]
> No financial records, description labels, or monetary values leave your computer. RAG prompts are sent strictly to the local Ollama instance on `127.0.0.1`.
